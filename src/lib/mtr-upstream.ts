import { trainReportsFromPayload, type TrainReport } from "./trains";
import type { ScheduleSnapshot } from "./schedule-snapshot";
import { FRESH_MS, type SweepResult } from "./mtr-cache";

const SCHEDULE_ORIGIN = "https://rt.data.gov.hk";
const CODE = /^[A-Z0-9]{2,5}$/;
const DEFAULT_GAP_MS = 40;
const DEFAULT_WORKERS = 4;
const COVERAGE = 0.8;

export type Pair = { line: string; station: string };

export function scheduleUrl(pair: Pair): URL {
  if (!CODE.test(pair.line) || !CODE.test(pair.station)) {
    throw new Error("拒絕未登記的路綫或車站");
  }
  const url = new URL("/v1/transport/mtr/getSchedule.php", SCHEDULE_ORIGIN);
  url.searchParams.set("line", pair.line);
  url.searchParams.set("sta", pair.station);
  url.searchParams.set("lang", "TC");
  if (url.origin !== SCHEDULE_ORIGIN) throw new Error("到站查詢網址不正確");
  return url;
}

const WORKER_BATCH = 40;

function takeBatch(pairs: Pair[], have: Set<string>, batchSize: number): Pair[] {
  const remaining = pairs.filter((pair) => !have.has(`${pair.line}-${pair.station}`));
  if (remaining.length <= batchSize) return remaining;
  const queues = new Map<string, Pair[]>();
  for (const pair of remaining) {
    const queue = queues.get(pair.line) ?? [];
    queue.push(pair);
    queues.set(pair.line, queue);
  }
  const batch: Pair[] = [];
  while (batch.length < batchSize) {
    let progressed = false;
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (!next) continue;
      batch.push(next);
      progressed = true;
      if (batch.length >= batchSize) break;
    }
    if (!progressed) break;
  }
  return batch;
}

export async function nextScheduleBatch(
  pairs: Pair[],
  existing: ScheduleSnapshot | null,
  fetchImpl: typeof fetch,
  batchSize = pairs.length,
): Promise<SweepResult> {
  const have = new Set(Object.keys(existing?.stations ?? {}));
  const batch = takeBatch(pairs, have, batchSize);
  if (batch.length === 0 && existing) {
    return { kind: "ok", holdMs: FRESH_MS, snapshot: { ...existing, complete: true } };
  }
  const paced = batch.length > WORKER_BATCH;
  const swept = await fetchNetwork(batch, fetchImpl, paced ? { workers: 4 } : { gapMs: 0, workers: 4 });
  if (swept.kind === "limited") return swept;
  const stations = { ...(existing?.stations ?? {}), ...swept.snapshot.stations };
  const reports = Object.entries(stations).flatMap(([key, payload]) => {
    const split = key.indexOf("-");
    return trainReportsFromPayload(key.slice(0, split), key.slice(split + 1), payload);
  });
  const complete = pairs.length === 0 || Object.keys(stations).length >= pairs.length * 0.8;
  return {
    kind: "ok",
    holdMs: complete ? Math.max(FRESH_MS, swept.holdMs) : 0,
    snapshot: { fetchedAt: Date.now(), freshUntil: Date.now(), reports, stations, complete },
  };
}

export async function fetchNetwork(
  pairs: Pair[],
  fetchImpl: typeof fetch,
  options: { gapMs?: number; workers?: number } = {},
): Promise<SweepResult> {
  const gapMs = options.gapMs ?? DEFAULT_GAP_MS;
  const workers = options.workers ?? DEFAULT_WORKERS;
  const stations: Record<string, unknown> = {};
  const reports: TrainReport[] = [];
  let cursor = 0;
  let nextStart = 0;
  let stopped = false;
  let retryAfterMs = 60_000;
  let successes = 0;

  async function worker(): Promise<void> {
    while (!stopped) {
      const index = cursor;
      cursor += 1;
      if (index >= pairs.length) return;
      const now = Date.now();
      const start = Math.max(now, nextStart);
      nextStart = start + gapMs;
      const wait = start - now;
      if (wait > 0) await delay(wait);
      if (stopped) return;
      const pair = pairs[index];
      if (!pair) return;
      const result = await fetchPair(pair, fetchImpl);
      if (result.kind === "limited") {
        stopped = true;
        retryAfterMs = result.retryAfterMs;
        return;
      }
      if (result.kind === "ok") {
        successes += 1;
        stations[`${pair.line}-${pair.station}`] = result.payload;
        reports.push(...trainReportsFromPayload(pair.line, pair.station, result.payload));
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  const fetchedAt = Date.now();
  const snapshot: ScheduleSnapshot = { fetchedAt, freshUntil: fetchedAt, reports, stations };
  const holdMs = stopped ? Math.max(FRESH_MS, retryAfterMs) : FRESH_MS;
  if (pairs.length === 0 || successes >= pairs.length * COVERAGE) {
    return { kind: "ok", snapshot, holdMs };
  }
  return { kind: "limited", retryAfterMs: holdMs };
}

async function fetchPair(pair: Pair, fetchImpl: typeof fetch): Promise<
  | { kind: "ok"; payload: unknown }
  | { kind: "skip" }
  | { kind: "limited"; retryAfterMs: number }
> {
  try {
    const response = await fetchImpl(scheduleUrl(pair), { cache: "no-store", redirect: "manual" });
    if (response.status >= 300 && response.status < 400) return { kind: "skip" };
    if (response.status === 429) {
      return { kind: "limited", retryAfterMs: retryDelay(response.headers.get("retry-after")) };
    }
    if (!response.ok) return { kind: "skip" };
    return { kind: "ok", payload: await response.json() };
  } catch {
    return { kind: "skip" };
  }
}

function retryDelay(header: string | null): number {
  if (!header) return 60_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dated = Date.parse(header);
  if (Number.isNaN(dated)) return 60_000;
  return dated - Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
