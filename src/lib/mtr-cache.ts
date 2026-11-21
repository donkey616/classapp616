import type { ScheduleSnapshot } from "./schedule-snapshot";

export const FRESH_MS = 60_000;
export const COOLDOWN_MS = 60_000;
const MAX_HOLD_MS = 5 * 60_000;
const STALE_OK_MS = 10 * 60_000;
const LOCK_MS = 90_000;

export type SweepResult =
  | { kind: "ok"; snapshot: ScheduleSnapshot; holdMs: number }
  | { kind: "limited"; retryAfterMs: number };

export type StoredRow = {
  snapshot: ScheduleSnapshot | null;
  freshUntil: number;
  refreshUntil: number;
};

export interface ScheduleStore {
  read(): Promise<StoredRow | null>;
  tryClaim(now: number, refreshUntil: number): Promise<boolean>;
  save(snapshot: ScheduleSnapshot, freshUntil: number): Promise<void>;
  cooldown(until: number): Promise<void>;
}

export function memoryStore(initial: StoredRow | null = null): ScheduleStore {
  let row = initial;
  return {
    async read() {
      return row ? { ...row, snapshot: row.snapshot ? { ...row.snapshot } : null } : null;
    },
    async tryClaim(now, refreshUntil) {
      if (row && (row.freshUntil > now || row.refreshUntil > now)) return false;
      row = {
        snapshot: row?.snapshot ?? null,
        freshUntil: row?.freshUntil ?? 0,
        refreshUntil,
      };
      return true;
    },
    async save(snapshot, freshUntil) {
      row = { snapshot, freshUntil, refreshUntil: 0 };
    },
    async cooldown(until) {
      const snapshot = row?.snapshot ? { ...row.snapshot, freshUntil: until } : null;
      row = { snapshot, freshUntil: until, refreshUntil: 0 };
    },
  };
}

export async function loadSchedules(args: {
  store: ScheduleStore;
  loadFresh: () => Promise<SweepResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ScheduleSnapshot | null> {
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? delay;
  const existing = await args.store.read();
  if (existing && existing.freshUntil > now()) return existing.snapshot;

  const claimed = await args.store.tryClaim(now(), now() + LOCK_MS);
  if (!claimed) {
    if (existing?.snapshot && now() - existing.snapshot.fetchedAt < STALE_OK_MS) return existing.snapshot;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleep(500);
      const again = await args.store.read();
      if (again?.snapshot && again.freshUntil > now()) return again.snapshot;
      if (!again || (again.refreshUntil <= now() && again.freshUntil <= now())) break;
    }
    return (await args.store.read())?.snapshot ?? null;
  }

  try {
    const sweep = await args.loadFresh();
    if (sweep.kind === "ok") {
      const freshUntil = now() + clampHold(sweep.holdMs);
      const snapshot = { ...sweep.snapshot, freshUntil };
      await args.store.save(snapshot, freshUntil);
      return snapshot;
    }
    await args.store.cooldown(now() + clampHold(sweep.retryAfterMs));
    return (await args.store.read())?.snapshot ?? null;
  } catch {
    try {
      await args.store.cooldown(now() + COOLDOWN_MS);
    } catch {
      // The claim expires on its own if the store cannot record the pause.
    }
    return existing?.snapshot ?? (await args.store.read())?.snapshot ?? null;
  }
}

function clampHold(ms: number): number {
  if (!Number.isFinite(ms)) return COOLDOWN_MS;
  return Math.min(MAX_HOLD_MS, Math.max(COOLDOWN_MS, ms));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
