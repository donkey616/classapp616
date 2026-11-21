import { createScheduleStore } from "./mtr-store";
import type { ScheduleStore } from "./mtr-cache";
import { sql } from "./db";

export function createDatabaseStore(): Promise<ScheduleStore> {
  return Promise.resolve(createScheduleStore(sql));
}
