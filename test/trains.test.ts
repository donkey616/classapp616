import assert from "node:assert/strict";
import test from "node:test";
import { buildSegments, placeTrains, trainCoordinate, type TrackLine, type TrackStation, type TrainReport } from "../src/lib/trains.ts";

const stations: TrackStation[] = [
  { code: "A", nameZh: "甲", lon: 114.1, lat: 22.3 },
  { code: "B", nameZh: "乙", lon: 114.11, lat: 22.3 },
  { code: "C", nameZh: "丙", lon: 114.12, lat: 22.3 },
];

const line: TrackLine = {
  code: "ISL",
  nameZh: "港島綫",
  color: "#007DC5",
  sequences: [["A", "B", "C"]],
  extraSegments: [],
  tracks: [[
    [114.1, 22.3],
    [114.105, 22.304],
    [114.11, 22.3],
    [114.115, 22.296],
    [114.12, 22.3],
  ]],
};

test("places a train on the curved approach to its next station", () => {
  const now = Date.parse("2026-11-21T10:35:00+08:00");
  const segments = buildSegments([line], stations);
  const reports: TrainReport[] = [{
    line: "ISL",
    station: "B",
    direction: "UP",
    dest: "C",
    arrival: "2026-11-21 10:35:40",
  }];
  const placed = placeTrains([line], stations, segments, reports, now);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].nextStation, "B");
  const point = trainCoordinate(placed[0], now);
  assert.ok(point[0] > 114.1 && point[0] < 114.11);
  const later = trainCoordinate(placed[0], now + 20_000);
  assert.ok(later[0] > point[0]);
});

test("does not draw the same train again at a station it has not reached", () => {
  const now = Date.parse("2026-11-21T10:35:00+08:00");
  const segments = buildSegments([line], stations);
  const reports: TrainReport[] = [
    { line: "ISL", station: "B", direction: "UP", dest: "C", arrival: "2026-11-21 10:35:30" },
    { line: "ISL", station: "C", direction: "UP", dest: "C", arrival: "2026-11-21 10:38:30" },
  ];
  const placed = placeTrains([line], stations, segments, reports, now);
  assert.deepEqual(placed.map((train) => train.nextStation), ["B"]);
});
