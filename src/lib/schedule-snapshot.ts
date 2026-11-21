import type { TrainReport } from "./trains";

export type ScheduleSnapshot = {
  fetchedAt: number;
  freshUntil: number;
  reports: TrainReport[];
  stations: Record<string, unknown>;
  complete?: boolean;
};

export function isScheduleSnapshot(value: unknown): value is ScheduleSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Partial<ScheduleSnapshot>;
  if (typeof body.fetchedAt !== "number" || typeof body.freshUntil !== "number") return false;
  if (!Array.isArray(body.reports) || !body.stations || typeof body.stations !== "object" || Array.isArray(body.stations)) {
    return false;
  }
  return body.reports.every(isTrainReport);
}

function isTrainReport(value: unknown): value is TrainReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<TrainReport>;
  return (report.direction === "UP" || report.direction === "DOWN")
    && typeof report.line === "string"
    && typeof report.station === "string"
    && typeof report.dest === "string"
    && typeof report.arrival === "string";
}
