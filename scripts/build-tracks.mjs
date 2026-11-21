/**
 * Replaces the straight station-to-station paths with curved track geometry
 * from OpenStreetMap route relations. Station points stay on the official
 * Lands Department coordinates.
 */

import { readFile, writeFile } from "node:fs/promises";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const LINE_CODES = ["ISL", "TWL", "KTL", "TKL", "TML", "EAL", "SIL", "TCL", "AEL", "DRL"];
const JOIN_METERS = 30;
const NOVEL_METERS = 40;
const SIMPLIFY_METERS = 12;
const MAX_STATION_GAP_METERS = 350;

const networkUrl = new URL("../src/data/network.json", import.meta.url);
const network = JSON.parse(await readFile(networkUrl, "utf8"));

function metersBetween(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111_320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110_540;
  return Math.hypot(dx, dy);
}

function pathLength(path) {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) total += metersBetween(path[index - 1], path[index]);
  return total;
}

function pointToSegment(point, start, end) {
  const lat = point[1] * (Math.PI / 180);
  const originX = point[0] * 111_320 * Math.cos(lat);
  const originY = point[1] * 110_540;
  const ax = start[0] * 111_320 * Math.cos(lat) - originX;
  const ay = start[1] * 110_540 - originY;
  const bx = end[0] * 111_320 * Math.cos(lat) - originX;
  const by = end[1] * 110_540 - originY;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  if (lengthSquared === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / lengthSquared));
  return Math.hypot(ax + (bx - ax) * t, ay + (by - ay) * t);
}

function distanceToPath(point, path) {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    best = Math.min(best, pointToSegment(point, path[index - 1], path[index]));
  }
  return best;
}

function sampleEvery(path, spacing) {
  const points = [path[0]];
  let since = 0;
  for (let index = 1; index < path.length; index += 1) {
    const step = metersBetween(path[index - 1], path[index]);
    since += step;
    if (since >= spacing) {
      points.push(path[index]);
      since = 0;
    }
  }
  points.push(path[path.length - 1]);
  return points;
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let max = 0;
    let index = start;
    for (let cursor = start + 1; cursor < end; cursor += 1) {
      const distance = pointToSegment(points[cursor], points[start], points[end]);
      if (distance > max) {
        max = distance;
        index = cursor;
      }
    }
    if (max > tolerance && index !== start) {
      keep.add(index);
      stack.push([start, index], [index, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

function attach(path, way) {
  const variants = [way, [...way].reverse()];
  for (const segment of variants) {
    if (metersBetween(path[path.length - 1], segment[0]) <= JOIN_METERS) return path.concat(segment.slice(1));
    if (metersBetween(path[0], segment[segment.length - 1]) <= JOIN_METERS) return segment.slice(0, -1).concat(path);
  }
  return null;
}

function mergeWays(ways) {
  const unused = ways.map((way) => way.map((point) => [point[0], point[1]]));
  const paths = [];
  while (unused.length > 0) {
    let path = unused.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let index = 0; index < unused.length; index += 1) {
        const joined = attach(path, unused[index]);
        if (!joined) continue;
        path = joined;
        unused.splice(index, 1);
        grew = true;
        break;
      }
    }
    if (path.length >= 2 && pathLength(path) >= 80) paths.push(path);
  }
  return paths;
}

function keepNovel(paths) {
  const kept = [];
  const sorted = [...paths].sort((a, b) => pathLength(b) - pathLength(a));
  for (const path of sorted) {
    const probes = sampleEvery(path, 120);
    const far = probes.filter((point) => kept.every((existing) => distanceToPath(point, existing) > NOVEL_METERS));
    if (kept.length === 0 || far.length >= 2) kept.push(simplify(path, SIMPLIFY_METERS));
  }
  return kept;
}

async function fetchTracks(body) {
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "hk-smart-city-map/1.0 (classroom map)",
        },
        body,
      });
      if (!response.ok) throw new Error(`${url} 回應 ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`OpenStreetMap 路軌查詢失敗：${lastError instanceof Error ? lastError.message : lastError}`);
}

const query = `
[out:json][timeout:180];
relation["route"="subway"]["network"="港鐵 MTR"]["ref"~"^(${LINE_CODES.join("|")})$"](22.13,113.82,22.58,114.45);
out geom;
`;
const payload = await fetchTracks(query);
const relations = payload.elements.filter((element) => element.type === "relation");

const waysByLine = new Map(LINE_CODES.map((code) => [code, []]));
for (const relation of relations) {
  const code = relation.tags?.ref;
  if (!waysByLine.has(code)) continue;
  for (const member of relation.members ?? []) {
    if (member.type !== "way" || !Array.isArray(member.geometry) || member.geometry.length < 2) continue;
    if (/platform|stop|station/i.test(member.role ?? "")) continue;
    const line = member.geometry.map((point) => [Number(point.lon.toFixed(6)), Number(point.lat.toFixed(6))]);
    waysByLine.get(code).push(line);
  }
}

const stations = new Map(network.stations.map((station) => [station.code, station]));
for (const line of network.lines) {
  const merged = mergeWays(waysByLine.get(line.code) ?? []);
  const tracks = keepNovel(merged).map((path) => path.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]));
  if (tracks.length === 0) throw new Error(`${line.code} 沒有路軌幾何`);
  const gaps = line.stationCodes.map((code) => {
    const station = stations.get(code);
    const point = [station.lon, station.lat];
    const gap = Math.min(...tracks.map((track) => distanceToPath(point, track)));
    return { code, gap };
  });
  const worst = gaps.reduce((best, item) => (item.gap > best.gap ? item : best));
  if (worst.gap > MAX_STATION_GAP_METERS) {
    throw new Error(`${line.code} ${worst.code} 距離路軌 ${Math.round(worst.gap)} 米`);
  }
  line.tracks = tracks;
  const points = tracks.reduce((total, track) => total + track.length, 0);
  console.log(`${line.code} 彎線 ${tracks.length} 條、${points} 點，最遠車站 ${worst.code} ${Math.round(worst.gap)} 米`);
}

network.sources.tracks = "https://www.openstreetmap.org/ (route=subway, network=港鐵 MTR)";
network.tracksGeneratedAt = new Date().toISOString();
await writeFile(networkUrl, `${JSON.stringify(network, null, 2)}\n`);
console.log(`已寫入彎線路軌，時間 ${network.tracksGeneratedAt}`);
