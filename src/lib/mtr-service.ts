import "server-only";
import { createDatabaseStore } from "@hk/database-store";
import { network } from "../network";
import { loadSchedules, memoryStore, type ScheduleStore } from "./mtr-cache";
import { edgeCacheStore } from "./mtr-edge-cache";
import { nextScheduleBatch } from "./mtr-upstream";
import type { ScheduleSnapshot } from "./schedule-snapshot";

const pairs = network.lines.flatMap((line) => line.stationCodes.map((station) => ({
  line: line.code,
  station,
})));
const STALE_MS = 10 * 60_000;
const WORKER_BATCH = 40;

type Slot = {
  memory: ScheduleSnapshot | null;
  pending: Promise<ScheduleSnapshot | null> | null;
};

const productionSlot: Slot = { memory: null, pending: null };
const previewSlot: Slot = { memory: null, pending: null };
const previewStore = memoryStore();
let productionStore: Promise<ScheduleStore> | undefined;

export function getSharedSchedules(stage: "production" | "preview"): Promise<ScheduleSnapshot | null> {
  if (stage === "preview") return readSlot(previewSlot, Promise.resolve(previewStore));
  productionStore ??= chooseProductionStore();
  return readSlot(productionSlot, productionStore);
}

function chooseProductionStore(): Promise<ScheduleStore> {
  if (onWorker()) return Promise.resolve(edgeCacheStore() ?? memoryStore());
  return createDatabaseStore();
}

function onWorker(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function readSlot(slot: Slot, storeReady: Promise<ScheduleStore>): Promise<ScheduleSnapshot | null> {
  const now = Date.now();
  if (slot.memory && slot.memory.freshUntil > now) return Promise.resolve(slot.memory);
  const usable = slot.memory && now - slot.memory.fetchedAt < STALE_MS ? slot.memory : null;
  if (!slot.pending) {
    slot.pending = storeReady.then((store) => loadSchedules({
      store,
      loadFresh: async () => {
        const existing = (await store.read())?.snapshot ?? null;
        return nextScheduleBatch(pairs, existing, fetch, onWorker() ? WORKER_BATCH : pairs.length);
      },
    })).then((snapshot) => {
      if (snapshot) slot.memory = snapshot;
      return snapshot;
    }).finally(() => {
      slot.pending = null;
    });
  }
  return usable ? Promise.resolve(usable) : slot.pending;
}
