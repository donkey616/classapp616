import { isScheduleSnapshot, type ScheduleSnapshot } from "./schedule-snapshot";
import type { ScheduleStore } from "./mtr-cache";

export type SqlQuery = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

type CacheRow = {
  body: unknown;
  fresh_until_ms: number | string;
  refresh_until_ms: number | string;
};

export function createScheduleStore(query: SqlQuery): ScheduleStore {
  return {
    async read() {
      const rows = await query<CacheRow>(
        "select body, fresh_until_ms, refresh_until_ms from mtr_schedule_cache where cache_key = 'network'",
      );
      const row = rows[0];
      if (!row) return null;
      return {
        snapshot: snapshotFrom(row.body),
        freshUntil: Number(row.fresh_until_ms),
        refreshUntil: Number(row.refresh_until_ms),
      };
    },
    async tryClaim(now, refreshUntil) {
      const rows = await query<{ cache_key: string }>(
        `insert into mtr_schedule_cache (cache_key, body, fresh_until_ms, refresh_until_ms)
         values ('network', null, 0, $2)
         on conflict (cache_key) do update
           set refresh_until_ms = excluded.refresh_until_ms
           where mtr_schedule_cache.fresh_until_ms <= $1
             and mtr_schedule_cache.refresh_until_ms <= $1
         returning cache_key`,
        [now, refreshUntil],
      );
      return rows.length > 0;
    },
    async save(snapshot, freshUntil) {
      await query(
        `update mtr_schedule_cache
         set body = $1::jsonb, fresh_until_ms = $2, refresh_until_ms = 0
         where cache_key = 'network'`,
        [JSON.stringify(snapshot), freshUntil],
      );
    },
    async cooldown(until) {
      const rows = await query<CacheRow>(
        "select body from mtr_schedule_cache where cache_key = 'network'",
      );
      const snapshot = snapshotFrom(rows[0]?.body);
      await writeBody(query, snapshot ? { ...snapshot, freshUntil: until } : null, until);
    },
  };
}

async function writeBody(query: SqlQuery, snapshot: ScheduleSnapshot | null, until: number): Promise<void> {
  await query(
    `update mtr_schedule_cache
     set body = $1::jsonb, fresh_until_ms = $2, refresh_until_ms = 0
     where cache_key = 'network'`,
    [snapshot ? JSON.stringify(snapshot) : null, until],
  );
}

function snapshotFrom(body: unknown): ScheduleSnapshot | null {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) as unknown : body;
    return isScheduleSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
