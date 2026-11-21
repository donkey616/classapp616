import type { ScheduleStore, StoredRow } from "./mtr-cache";

const CACHE_URL = "https://hk-smart-city-map.internal/mtr-schedule";

export function edgeCacheStore(): ScheduleStore | null {
  const cache = workerCache();
  if (!cache) return null;
  const read = async (): Promise<StoredRow | null> => {
    const hit = await cache.match(CACHE_URL);
    if (!hit) return null;
    try {
      const body: unknown = await hit.json();
      if (!isRow(body)) return null;
      return body;
    } catch {
      return null;
    }
  };
  const write = async (row: StoredRow) => {
    await cache.put(CACHE_URL, Response.json(row, {
      headers: { "cache-control": "public, max-age=600" },
    }));
  };
  return {
    read,
    async tryClaim(now, refreshUntil) {
      const current = await read();
      if (current && (current.freshUntil > now || current.refreshUntil > now)) return false;
      await write({
        snapshot: current?.snapshot ?? null,
        freshUntil: current?.freshUntil ?? 0,
        refreshUntil,
      });
      return true;
    },
    async save(snapshot, freshUntil) {
      await write({ snapshot, freshUntil, refreshUntil: 0 });
    },
    async cooldown(until) {
      const current = await read();
      const snapshot = current?.snapshot ? { ...current.snapshot, freshUntil: until } : null;
      await write({ snapshot, freshUntil: until, refreshUntil: 0 });
    },
  };
}

function workerCache(): Cache | null {
  const storage = globalThis.caches as (CacheStorage & { default?: Cache }) | undefined;
  return storage?.default ?? null;
}

function isRow(value: unknown): value is StoredRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredRow>;
  return typeof row.freshUntil === "number" && typeof row.refreshUntil === "number" && "snapshot" in row;
}
