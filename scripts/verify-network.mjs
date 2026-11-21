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

if (!network.generatedAt || Number.isNaN(Date.parse(network.generatedAt))) {
  throw new Error("缺少讀取時間");
}

console.log("路綫和 98 個車站核對通過");
