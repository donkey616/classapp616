const SPEED_METERS_PER_SECOND = 15;
const MINIMUM_SEGMENT_SECONDS = 50;

export type TrackLine = {
  code: string;
  nameZh: string;
  color: string;
  sequences: string[][];
  extraSegments: string[][];
  tracks: number[][][];
};

export type TrackStation = {
  code: string;
  nameZh: string;
  lon: number;
  lat: number;
};

export type TrainReport = {
  line: string;
  station: string;
  direction: "UP" | "DOWN";
  dest: string;
  arrival: string;
};

export type RouteSegment = {
  line: string;
  from: string;
  to: string;
  coordinates: number[][];
  length: number;
};

export type PlacedTrain = {
  id: string;
  line: string;
  lineName: string;
  color: string;
  stroke: string;
  strokeWidth: number;
  direction: "UP" | "DOWN";
  dest: string;
  destName: string;
  nextStation: string;
  nextName: string;
  coordinates: number[][];
  length: number;
  etaSeconds: number;
  arrivalMs: number;
  departing: boolean;
};

export function directionStyle(lineColor: string, direction: "UP" | "DOWN"): { color: string; stroke: string; strokeWidth: number } {
  if (direction === "UP") return { color: lineColor, stroke: "#fffdf8", strokeWidth: 1.5 };
  return { color: mixHex(lineColor, "#14181c", 0.7), stroke: lineColor, strokeWidth: 3.5 };
}

export function buildSegments(lines: TrackLine[], stations: TrackStation[]): RouteSegment[] {
  const stationAt = new Map(stations.map((station) => [station.code, station]));
  const segments: RouteSegment[] = [];
  for (const line of lines) {
    const edges = new Map<string, [string, string]>();
    for (const sequence of line.sequences) {
      for (let index = 1; index < sequence.length; index += 1) {
        rememberEdge(edges, sequence[index - 1], sequence[index]);
      }
    }
    for (const [left, right] of line.extraSegments) rememberEdge(edges, left, right);
    for (const [from, to] of edges.values()) {
      const start = stationAt.get(from);
      const end = stationAt.get(to);
      if (!start || !end) continue;
      const coordinates = sliceTrack(line.tracks, [start.lon, start.lat], [end.lon, end.lat]);
      segments.push({
        line: line.code,
        from,
        to,
        coordinates,
        length: pathLength(coordinates),
      });
    }
  }
  return segments;
}

export function placeTrains(
  lines: TrackLine[],
  stations: TrackStation[],
  segments: RouteSegment[],
  reports: TrainReport[],
  nowMs: number,
): PlacedTrain[] {
  const names = new Map(stations.map((station) => [station.code, station.nameZh]));
  const neighbors = adjacency(lines);
  const byLine = new Map(lines.map((line) => [line.code, line]));
  const segmentAt = new Map(segments.map((segment) => [`${segment.line}|${segment.from}|${segment.to}`, segment]));
  const placed: PlacedTrain[] = [];
  for (const report of reports) {
    const line = byLine.get(report.line);
    if (!line) continue;
    const arrivalMs = hongKongTimeMs(report.arrival);
    if (arrivalMs == null) continue;
    const etaSeconds = (arrivalMs - nowMs) / 1000;
    if (etaSeconds < -20) continue;
    const approach = incomingStation(report.station, report.dest, line, neighbors);
    const departure = approach ? null : outgoingStation(report.station, report.dest, line);
    const from = approach ?? report.station;
    const toward = approach ? report.station : departure;
    if (!toward) continue;
    const forward = segmentAt.get(`${line.code}|${from}|${toward}`);
    const backward = segmentAt.get(`${line.code}|${toward}|${from}`);
    const segment = forward ?? (backward ? { ...backward, coordinates: [...backward.coordinates].reverse() } : null);
    if (!segment || segment.length < 30) continue;
    const segmentSeconds = Math.max(MINIMUM_SEGMENT_SECONDS, segment.length / SPEED_METERS_PER_SECOND);
    const departing = approach == null;
    if (departing) {
      if (etaSeconds > segmentSeconds || etaSeconds < -segmentSeconds) continue;
    } else if (etaSeconds > segmentSeconds) {
      continue;
    }
    const paint = directionStyle(line.color, report.direction);
    placed.push({
      id: `${line.code}|${from}|${toward}|${report.dest}|${Math.round(arrivalMs / 1000)}`,
      line: line.code,
      lineName: line.nameZh,
      color: paint.color,
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth,
      direction: report.direction,
      dest: report.dest,
      destName: names.get(report.dest) ?? report.dest,
      nextStation: toward,
      nextName: names.get(toward) ?? toward,
      coordinates: segment.coordinates,
      length: segment.length,
      etaSeconds,
      arrivalMs,
      departing,
    });
  }
  return placed;
}

export function trainCoordinate(train: PlacedTrain, nowMs: number): [number, number] {
  const etaSeconds = train.etaSeconds - (nowMs - (train.arrivalMs - train.etaSeconds * 1000)) / 1000;
  const segmentSeconds = Math.max(MINIMUM_SEGMENT_SECONDS, train.length / SPEED_METERS_PER_SECOND);
  if (train.departing) {
    const progress = etaSeconds > 0 ? 0.03 : clamp(-etaSeconds / segmentSeconds, 0.03, 0.97);
    return pointAlong(train.coordinates, progress);
  }
  const progress = clamp(1 - etaSeconds / segmentSeconds, 0.03, 0.97);
  return pointAlong(train.coordinates, progress);
}

export function trainReportsFromPayload(line: string, station: string, payload: unknown): TrainReport[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as {
    status?: number | string;
    data?: Record<string, { UP?: RawTrain[]; DOWN?: RawTrain[] }>;
  };
  if (Number(body.status) === 0) return [];
  const node = body.data?.[`${line}-${station}`];
  if (!node) return [];
  const reports: TrainReport[] = [];
  for (const direction of ["UP", "DOWN"] as const) {
    for (const train of node[direction] ?? []) {
      if (!train.dest || !train.time || train.time === "-") continue;
      reports.push({ line, station, direction, dest: train.dest, arrival: train.time });
    }
  }
  return reports;
}

type RawTrain = { dest?: string; time?: string };

function incomingStation(station: string, dest: string, line: TrackLine, neighbors: Map<string, string[]>): string | null {
  const distances = distancesFrom(dest, neighbors);
  const here = distances.get(station);
  if (here == null) return incomingFromSequence(station, dest, line);
  const candidates = (neighbors.get(station) ?? []).filter((next) => {
    const distance = distances.get(next);
    return distance != null && distance > here;
  });
  if (candidates.length === 0) return incomingFromSequence(station, dest, line);
  const alongDestination = line.sequences.filter((sequence) => sequence.includes(dest) && sequence.includes(station));
  return candidates.find((next) => alongDestination.some((sequence) => sequence.includes(next))) ?? candidates[0];
}

function outgoingStation(station: string, dest: string, line: TrackLine): string | null {
  const sequence = line.sequences.find((item) => item.includes(station) && item.includes(dest));
  if (!sequence) return null;
  const index = sequence.indexOf(station);
  const destIndex = sequence.indexOf(dest);
  const next = destIndex >= index ? index + 1 : index - 1;
  if (next < 0 || next >= sequence.length) return null;
  return sequence[next];
}

function incomingFromSequence(station: string, dest: string, line: TrackLine): string | null {
  const sequence = line.sequences.find((item) => item.includes(station) && item.includes(dest));
  if (!sequence) return null;
  const index = sequence.indexOf(station);
  const destIndex = sequence.indexOf(dest);
  const previous = destIndex >= index ? index - 1 : index + 1;
  if (previous < 0 || previous >= sequence.length) return null;
  return sequence[previous];
}

function adjacency(lines: TrackLine[]): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const link = (left: string, right: string) => {
    const list = neighbors.get(left) ?? [];
    if (!list.includes(right)) list.push(right);
    neighbors.set(left, list);
  };
  for (const line of lines) {
    for (const sequence of line.sequences) {
      for (let index = 1; index < sequence.length; index += 1) {
        link(sequence[index - 1], sequence[index]);
        link(sequence[index], sequence[index - 1]);
      }
    }
    for (const [left, right] of line.extraSegments) {
      link(left, right);
      link(right, left);
    }
  }
  return neighbors;
}

function distancesFrom(origin: string, neighbors: Map<string, string[]>): Map<string, number> {
  const distance = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const base = distance.get(current) ?? 0;
    for (const next of neighbors.get(current) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, base + 1);
      queue.push(next);
    }
  }
  return distance;
}

function rememberEdge(edges: Map<string, [string, string]>, left: string, right: string): void {
  const key = left < right ? `${left}|${right}` : `${right}|${left}`;
  if (!edges.has(key)) edges.set(key, left < right ? [left, right] : [right, left]);
}

function sliceTrack(tracks: number[][][], start: number[], end: number[]): number[][] {
  const straight = metersBetween(start, end);
  let best: { track: number[][]; startChain: number; endChain: number; score: number } | null = null;
  for (const track of tracks) {
    for (const projectedStart of approaches(track, start)) {
      for (const projectedEnd of approaches(track, end)) {
        const along = Math.abs(projectedStart.chainage - projectedEnd.chainage);
        if (along < 40) continue;
        if (straight > 0 && (along < straight * 0.75 || along > straight * 3)) continue;
        const score = projectedStart.offset + projectedEnd.offset + Math.abs(along - straight) * 0.02;
        if (!best || score < best.score) {
          best = { track, startChain: projectedStart.chainage, endChain: projectedEnd.chainage, score };
        }
      }
    }
  }
  if (!best) return snapOntoTracks(tracks, start, end);
  const low = Math.min(best.startChain, best.endChain);
  const high = Math.max(best.startChain, best.endChain);
  const coordinates = [pointAtChainage(best.track, low)];
  let chainage = 0;
  for (let index = 1; index < best.track.length; index += 1) {
    chainage += metersBetween(best.track[index - 1], best.track[index]);
    if (chainage > low + 1 && chainage < high - 1) coordinates.push(best.track[index]);
  }
  coordinates.push(pointAtChainage(best.track, high));
  if (best.startChain > best.endChain) coordinates.reverse();
  return coordinates;
}

function approaches(track: number[][], point: number[]): Array<{ chainage: number; offset: number }> {
  const hits: Array<{ chainage: number; offset: number }> = [];
  let chainage = 0;
  for (let index = 1; index < track.length; index += 1) {
    const start = track[index - 1];
    const end = track[index];
    const step = metersBetween(start, end);
    const fraction = step === 0 ? 0 : closestFraction(point, start, end);
    const projected = [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ];
    const offset = metersBetween(point, projected);
    if (offset <= 280) hits.push({ chainage: chainage + step * fraction, offset });
    chainage += step;
  }
  hits.sort((left, right) => left.chainage - right.chainage);
  const clustered: Array<{ chainage: number; offset: number }> = [];
  for (const hit of hits) {
    const previous = clustered[clustered.length - 1];
    if (previous && hit.chainage - previous.chainage < 150) {
      if (hit.offset < previous.offset) clustered[clustered.length - 1] = hit;
    } else {
      clustered.push(hit);
    }
  }
  return clustered;
}

function snapOntoTracks(tracks: number[][][], start: number[], end: number[]): number[][] {
  const steps = Math.max(2, Math.round(metersBetween(start, end) / 120));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const fraction = index / steps;
    return nearestOnTracks(tracks, [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]);
  });
}

function nearestOnTracks(tracks: number[][][], point: number[]): number[] {
  let best = point;
  let bestOffset = Infinity;
  for (const track of tracks) {
    const projected = project(track, point);
    if (!projected || projected.offset >= bestOffset) continue;
    bestOffset = projected.offset;
    best = pointAtChainage(track, projected.chainage);
  }
  return best;
}

function project(track: number[][], point: number[]): { chainage: number; offset: number } | null {
  if (track.length < 2) return null;
  let chainage = 0;
  let best = { chainage: 0, offset: Infinity };
  for (let index = 1; index < track.length; index += 1) {
    const start = track[index - 1];
    const end = track[index];
    const step = metersBetween(start, end);
    const fraction = step === 0 ? 0 : closestFraction(point, start, end);
    const offset = metersBetween(point, [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]);
    const at = chainage + step * fraction;
    if (offset < best.offset) best = { chainage: at, offset };
    chainage += step;
  }
  return best;
}

function pointAtChainage(track: number[][], target: number): number[] {
  let chainage = 0;
  for (let index = 1; index < track.length; index += 1) {
    const step = metersBetween(track[index - 1], track[index]);
    if (chainage + step >= target || index === track.length - 1) {
      const fraction = step === 0 ? 0 : Math.max(0, Math.min(1, (target - chainage) / step));
      return [
        track[index - 1][0] + (track[index][0] - track[index - 1][0]) * fraction,
        track[index - 1][1] + (track[index][1] - track[index - 1][1]) * fraction,
      ];
    }
    chainage += step;
  }
  return track[track.length - 1];
}

function pointAlong(coordinates: number[][], fraction: number): [number, number] {
  const target = pathLength(coordinates) * fraction;
  let walked = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const step = metersBetween(coordinates[index - 1], coordinates[index]);
    if (walked + step >= target || index === coordinates.length - 1) {
      const portion = step === 0 ? 0 : Math.max(0, Math.min(1, (target - walked) / step));
      return [
        coordinates[index - 1][0] + (coordinates[index][0] - coordinates[index - 1][0]) * portion,
        coordinates[index - 1][1] + (coordinates[index][1] - coordinates[index - 1][1]) * portion,
      ];
    }
    walked += step;
  }
  const last = coordinates[coordinates.length - 1];
  return [last[0], last[1]];
}

function closestFraction(point: number[], start: number[], end: number[]): number {
  const lat = point[1] * (Math.PI / 180);
  const scaleX = 111_320 * Math.cos(lat);
  const ax = (end[0] - start[0]) * scaleX;
  const ay = (end[1] - start[1]) * 110_540;
  const lengthSquared = ax * ax + ay * ay;
  if (lengthSquared === 0) return 0;
  const px = (point[0] - start[0]) * scaleX;
  const py = (point[1] - start[1]) * 110_540;
  return Math.max(0, Math.min(1, (px * ax + py * ay) / lengthSquared));
}

function pathLength(coordinates: number[][]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += metersBetween(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function metersBetween(a: number[], b: number[]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111_320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110_540;
  return Math.hypot(dx, dy);
}

function hongKongTimeMs(value: string | undefined): number | null {
  if (!value || value === "-") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}+08:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

function mixHex(from: string, to: string, amount: number): string {
  const start = rgb(from);
  const end = rgb(to);
  const channel = (left: number, right: number) => Math.round(left + (right - left) * amount);
  return toHex(channel(start.r, end.r), channel(start.g, end.g), channel(start.b, end.b));
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
