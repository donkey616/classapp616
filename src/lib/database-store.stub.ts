import { memoryStore, type ScheduleStore } from "./mtr-cache";

export function createDatabaseStore(): Promise<ScheduleStore> {
  return Promise.resolve(memoryStore());
}
