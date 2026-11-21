import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loadSchedules, memoryStore, type SweepResult } from "../src/lib/mtr-cache.ts";
import { createScheduleStore } from "../src/lib/mtr-store.ts";
import { fetchNetwork, scheduleUrl, type Pair } from "../src/lib/mtr-upstream.ts";
import type { ScheduleSnapshot } from "../src/lib/schedule-snapshot.ts";

const started = 1_700_000_000_000;

function snapshot(fetchedAt = started): ScheduleSnapshot {
  return {
    fetchedAt,
    freshUntil: fetchedAt,
    reports: [{ line: "EAL", station: "SHT", direction: "UP", dest: "LOW", arrival: "2026-11-21 14:00:00" }],
    stations: { "EAL-SHT": { status: 1, data: {} } },
  };
}

function ok(fetchedAt = started): SweepResult {
  return { kind: "ok", holdMs: 60_000, snapshot: snapshot(fetchedAt) };
}

test("a fresh cache is reused and does not call MTR again", async () => {
  let fetches = 0;
  const store = memoryStore();
  let clock = started;
  const loadFresh = async (): Promise<SweepResult> => {
    fetches += 1;
    return ok(clock);
  };
  const first = await loadSchedules({ store, loadFresh, now: () => clock, sleep: async () => {} });
  const second = await loadSchedules({ store, loadFresh, now: () => clock, sleep: async () => {} });
  assert.equal(fetches, 1);
  assert.equal(second?.fetchedAt, first?.fetchedAt);
  clock += 60_001;
  await loadSchedules({ store, loadFresh, now: () => clock, sleep: async () => {} });
  assert.equal(fetches, 2);
});

test("overlapping readers share one refresh", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fetches = 0;
  const store = memoryStore();
  const loadFresh = async (): Promise<SweepResult> => {
    fetches += 1;
    await gate;
    return ok();
  };
  const pending = Promise.all([
    loadSchedules({ store, loadFresh, now: () => started, sleep: async () => {} }),
    loadSchedules({ store, loadFresh, now: () => started, sleep: async () => {} }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetches, 1);
  release();
  await pending;
  assert.equal(fetches, 1);
});

test("a rate limit keeps the previous schedule and pauses another fetch", async () => {
  const previous = snapshot();
  const store = memoryStore({ snapshot: previous, freshUntil: 0, refreshUntil: 0 });
  let fetches = 0;
  let clock = started + 120_000;
  const loadFresh = async (): Promise<SweepResult> => {
    fetches += 1;
    return { kind: "limited", retryAfterMs: 60_000 };
  };
  const served = await loadSchedules({ store, loadFresh, now: () => clock, sleep: async () => {} });
  assert.equal(served?.fetchedAt, previous.fetchedAt);
  await loadSchedules({ store, loadFresh, now: () => clock, sleep: async () => {} });
  assert.equal(fetches, 1);
});

test("schedule requests stay on the MTR host", () => {
  const url = scheduleUrl({ line: "ISL", station: "CEN" });
  assert.equal(url.origin, "https://rt.data.gov.hk");
  assert.equal(url.searchParams.get("line"), "ISL");
  assert.equal(url.searchParams.get("sta"), "CEN");
  assert.throws(() => scheduleUrl({ line: "ISL", station: "https://evil.example" }));
  assert.throws(() => scheduleUrl({ line: "../", station: "CEN" }));
});

test("a rate limit stops the sweep instead of calling every station", async () => {
  const pairs: Pair[] = ["CEN", "ADM", "WAC", "CAB", "TIH"].map((station) => ({ line: "ISL", station }));
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://rt.data.gov.hk");
    return new Response("busy", { status: 429, headers: { "retry-after": "60" } });
  };
  const result = await fetchNetwork(pairs, fetchImpl, { gapMs: 0, workers: 2 });
  assert.equal(result.kind, "limited");
  assert.ok(calls < pairs.length);
  assert.ok(calls >= 1);
});

test("the shared store lets one refresh claim the rows", async () => {
  const db = new PGlite();
  await db.exec(await readFile("migrations/001_mtr_cache.sql", "utf8"));
  const store = createScheduleStore(async (text, params = []) => (await db.query(text, params)).rows);
  const now = started;
  assert.equal(await store.tryClaim(now, now + 90_000), true);
  assert.equal(await store.tryClaim(now, now + 90_000), false);
  let fetches = 0;
  const served = await loadSchedules({
    store,
    now: () => now + 1_000,
    sleep: async () => {},
    loadFresh: async () => {
      fetches += 1;
      return ok(now);
    },
  });
  assert.equal(fetches, 0);
  assert.equal(served, null);
  await store.save(snapshot(now), now + 60_000);
  const again = await loadSchedules({
    store,
    now: () => now + 1_000,
    sleep: async () => {},
    loadFresh: async () => {
      fetches += 1;
      return ok(now + 5_000);
    },
  });
  assert.equal(fetches, 0);
  assert.equal(again?.reports[0]?.dest, "LOW");
  const refreshed = await loadSchedules({
    store,
    now: () => now + 61_000,
    sleep: async () => {},
    loadFresh: async () => {
      fetches += 1;
      return ok(now + 61_000);
    },
  });
  assert.equal(fetches, 1);
  assert.equal(refreshed?.fetchedAt, now + 61_000);
});
