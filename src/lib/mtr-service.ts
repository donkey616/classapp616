import "server-only";
import { network } from "../network";
import { sql } from "./db";
import { loadSchedules, memoryStore, type ScheduleStore } from "./mtr-cache";
import { createScheduleStore } from "./mtr-store";
import { fetchNetwork } from "./mtr-upstream";
import type { ScheduleSnapshot } from "./schedule-snapshot";

const pairs = network.lines.flatMap((line) => line.stationCodes.map((station) => ({
  line: line.code,
  station,
})));
const STALE_MS = 10 * 60_000;

type Slot = {
  memory: ScheduleSnapshot | null;
  pending: Promise<ScheduleSnapshot | null> | null;
};

const productionSlot: Slot = { memory: null, pending: null };
const previewSlot: Slot = { memory: null, pending: null };
const productionStore = createScheduleStore(sql);
const previewStore = memoryStore();

export function getSharedSchedules(stage: "production" | "preview"): Promise<ScheduleSnapshot | null> {
  if (stage === "preview") return readSlot(previewSlot, previewStore);
  return readSlot(productionSlot, productionStore);
}

function readSlot(slot: Slot, store: ScheduleStore): Promise<ScheduleSnapshot | null> {
  const now = Date.now();
  if (slot.memory && slot.memory.freshUntil > now) return Promise.resolve(slot.memory);
  const usable = slot.memory && now - slot.memory.fetchedAt < STALE_MS ? slot.memory : null;
  if (!slot.pending) {
    slot.pending = loadSchedules({
      store,
      loadFresh: () => fetchNetwork(pairs, fetch),
    }).then((snapshot) => {
      if (snapshot) slot.memory = snapshot;
      return snapshot;
    }).finally(() => {
      slot.pending = null;
    });
  }
  return usable ? Promise.resolve(usable) : slot.pending;
}
