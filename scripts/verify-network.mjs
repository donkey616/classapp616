import { readFile } from "node:fs/promises";

const network = JSON.parse(await readFile(new URL("../src/data/network.json", import.meta.url), "utf8"));

function pair(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sameSet(left, right, label) {
  const extra = [...left].filter((item) => !right.has(item));
  const missing = [...right].filter((item) => !left.has(item));
  if (extra.length || missing.length) {
    throw new Error(`${label} 不一致。多了 ${extra.join(",")}，少了 ${missing.join(",")}`);
  }
}

if (network.stationCount !== 98 || network.stations.length !== 98) {
  throw new Error("車站應有 98 個");
}
if (network.lines.length !== 10) throw new Error("路綫應有 10 條");

const codes = new Set(network.stations.map((station) => station.code));
if (codes.size !== 98) throw new Error("車站代碼重覆");

const stations = new Map(network.stations.map((station) => [station.code, station]));
for (const station of network.stations) {
  if (station.lat < 22.1 || station.lat > 22.6 || station.lon < 113.8 || station.lon > 114.5) {
    throw new Error(`${station.code} 座標不在香港範圍`);
  }
  if (station.lines.length === 0) throw new Error(`${station.code} 沒有路綫`);
}

const admiralty = stations.get("ADM");
if (admiralty.lines.join() !== "ISL,TWL,EAL,SIL") throw new Error("金鐘的路綫不對");
const laiKing = stations.get("LAK");
if (laiKing.nameZh !== "茘景" || Math.abs(laiKing.lat - 22.348324) > 0.000001) {
  throw new Error("荔景站沒有對上地政總署座標");
}
const racecourse = stations.get("RAC");
const foTan = stations.get("FOT");
const university = stations.get("UNI");
if (!(foTan.lat < racecourse.lat && racecourse.lat < university.lat)) {
  throw new Error("馬場站應位於火炭與大學之間");
}

for (const line of network.lines) {
  const expected = new Set();
  for (const sequence of line.sequences) {
    for (let index = 1; index < sequence.length; index += 1) {
      expected.add(pair(sequence[index - 1], sequence[index]));
    }
  }
  for (const [left, right] of line.extraSegments) expected.add(pair(left, right));
  const drawn = new Set();
  line.pathCodes.forEach((path, pathIndex) => {
    if (path.length < 2) throw new Error(`${line.code} 有過短路段`);
    for (let index = 1; index < path.length; index += 1) {
      drawn.add(pair(path[index - 1], path[index]));
      const stop = stations.get(path[index]);
      const point = line.paths[pathIndex][index];
      if (point[0] !== stop.lon || point[1] !== stop.lat) {
        throw new Error(`${line.code} ${path[index]} 座標和車站不一致`);
      }
    }
    const first = stations.get(path[0]);
    const start = line.paths[pathIndex][0];
    if (start[0] !== first.lon || start[1] !== first.lat) throw new Error(`${line.code} 起點座標不對`);
  });
  sameSet(drawn, expected, line.code);
  const drawnStops = new Set(line.pathCodes.flat());
  sameSet(drawnStops, new Set(line.stationCodes), `${line.code} 車站`);
}

function distanceToPath(point, path) {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const lat = point[1] * (Math.PI / 180);
    const ox = point[0] * 111_320 * Math.cos(lat);
    const oy = point[1] * 110_540;
    const ax = start[0] * 111_320 * Math.cos(lat) - ox;
    const ay = start[1] * 110_540 - oy;
    const bx = end[0] * 111_320 * Math.cos(lat) - ox;
    const by = end[1] * 110_540 - oy;
    const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / lengthSquared));
    best = Math.min(best, Math.hypot(ax + (bx - ax) * t, ay + (by - ay) * t));
  }
  return best;
}

for (const line of network.lines) {
  if (!Array.isArray(line.tracks) || line.tracks.length === 0) throw new Error(`${line.code} 缺少彎線路軌`);
  const pointCount = line.tracks.reduce((total, track) => total + track.length, 0);
  if (pointCount <= line.stationCodes.length) throw new Error(`${line.code} 路軌點數不足以形成彎線`);
  for (const code of line.stationCodes) {
    const station = stations.get(code);
    const gap = Math.min(...line.tracks.map((track) => distanceToPath([station.lon, station.lat], track)));
    if (gap > 350) throw new Error(`${line.code} ${code} 距離路軌 ${Math.round(gap)} 米`);
    if (trackOutsideHongKong(line.tracks)) throw new Error(`${line.code} 路軌超出香港範圍`);
  }
}

function trackOutsideHongKong(tracks) {
  return tracks.some((track) => track.some(([lon, lat]) => lat < 22.1 || lat > 22.6 || lon < 113.8 || lon > 114.5));
}

if (!network.generatedAt || Number.isNaN(Date.parse(network.generatedAt))) {
  throw new Error("缺少讀取時間");
}

console.log("路綫和 98 個車站核對通過");
