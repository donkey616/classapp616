/**
 * Builds the station and line file from two public sources:
 * - Lands Department MTR venue polygons (bbox centre, WGS84)
 * - MTR lines-and-stations CSV (names, codes, running order)
 *
 * Racecourse is in the venue list and the next-train API, but not in the CSV.
 * It is joined by name and linked between Fo Tan and University.
 */

const VENUE_URL =
  "https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/mtr_venue_polygon?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application%2Fjson";
const LINE_URL = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv";

const LINES = [
  ["ISL", "港島綫", "#007DC5"],
  ["TWL", "荃灣綫", "#E2231A"],
  ["KTL", "觀塘綫", "#00A040"],
  ["TKL", "將軍澳綫", "#7D4998"],
  ["TML", "屯馬綫", "#9A3B26"],
  ["EAL", "東鐵綫", "#53B7E8"],
  ["SIL", "南港島綫", "#B5BD00"],
  ["TCL", "東涌綫", "#F7941D"],
  ["AEL", "機場快綫", "#1C7670"],
  ["DRL", "迪士尼綫", "#F173AC"],
];

const EXPECTED_COUNTS = {
  AEL: 5,
  TCL: 8,
  TML: 27,
  TKL: 8,
  EAL: 16,
  SIL: 5,
  TWL: 16,
  ISL: 17,
  KTL: 17,
  DRL: 2,
};

const EXTRA_SEGMENTS = {
  EAL: [
    ["FOT", "RAC"],
    ["RAC", "UNI"],
  ],
};

const lineOrder = new Map(LINES.map(([code], index) => [code, index]));

function normZh(name) {
  return name
    .trim()
    .replace(/鐵路站$/u, "")
    .replace(/站$/u, "")
    .replaceAll("荔", "茘");
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ""));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "hk-smart-city-map/1.0 (classroom map)" },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function keepSequences(sequences) {
  const kept = [];
  const sorted = [...sequences].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  for (const sequence of sorted) {
    const edges = new Set();
    for (let i = 1; i < sequence.length; i += 1) edges.add(pairKey(sequence[i - 1], sequence[i]));
    if (kept.some((item) => [...edges].every((edge) => item.edges.has(edge)))) continue;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      const subset = [...kept[i].edges].every((edge) => edges.has(edge));
      if (subset) kept.splice(i, 1);
    }
    kept.push({ sequence, edges });
  }
  return kept.map((item) => item.sequence);
}

function chain(edgePairs) {
  const adjacent = new Map();
  const unused = new Set();
  for (const [left, right] of edgePairs) {
    if (left === right) continue;
    if (!adjacent.has(left)) adjacent.set(left, new Set());
    if (!adjacent.has(right)) adjacent.set(right, new Set());
    adjacent.get(left).add(right);
    adjacent.get(right).add(left);
    unused.add(pairKey(left, right));
  }
  const nodes = [...adjacent.keys()].sort();
  const seeds = [...nodes.filter((node) => adjacent.get(node).size === 1), ...nodes];
  const paths = [];
  for (const seed of seeds) {
    for (const next of [...adjacent.get(seed)].sort()) {
      if (!unused.has(pairKey(seed, next))) continue;
      const path = [seed];
      let previous = seed;
      let current = next;
      while (unused.has(pairKey(previous, current))) {
        unused.delete(pairKey(previous, current));
        path.push(current);
        const onwards = [...adjacent.get(current)]
          .filter((node) => node !== previous && unused.has(pairKey(current, node)))
          .sort();
        if (onwards.length !== 1) break;
        previous = current;
        current = onwards[0];
      }
      paths.push(path);
    }
  }
  if (unused.size > 0) {
    throw new Error(`未畫出的路段：${[...unused].join(", ")}`);
  }
  return paths;
}

function orient(path) {
  const copy = [...path];
  if (copy[0] > copy[copy.length - 1]) copy.reverse();
  return copy;
}

const venuesPayload = JSON.parse(await fetchText(VENUE_URL));
const venues = venuesPayload.features;
if (!Array.isArray(venues) || venues.length !== 98) {
  throw new Error(`車站範圍應有 98 個，實際 ${venues?.length}`);
}

const csvRows = parseCsv(await fetchText(LINE_URL));
const header = csvRows[0];
const column = Object.fromEntries(header.map((name, index) => [name, index]));
for (const name of ["Line Code", "Station Code", "Chinese Name", "English Name", "Sequence"]) {
  if (column[name] === undefined) throw new Error(`路綫檔缺少欄位 ${name}`);
}

const byCode = new Map();
const sequencesByLine = new Map(LINES.map(([code]) => [code, []]));

for (const cells of csvRows.slice(1)) {
  const lineCode = cells[column["Line Code"]]?.trim();
  const stationCode = cells[column["Station Code"]]?.trim();
  if (!lineCode || !stationCode) continue;
  if (!lineOrder.has(lineCode)) throw new Error(`未知路綫 ${lineCode}`);
  const current = byCode.get(stationCode) ?? {
    code: stationCode,
    nameZh: cells[column["Chinese Name"]].trim(),
    nameEn: cells[column["English Name"]].trim(),
    lines: new Set(),
    lat: null,
    lon: null,
  };
  current.lines.add(lineCode);
  byCode.set(stationCode, current);
}

const grouped = new Map();
for (const cells of csvRows.slice(1)) {
  const lineCode = cells[column["Line Code"]]?.trim();
  const direction = cells[column.Direction]?.trim();
  const stationCode = cells[column["Station Code"]]?.trim();
  if (!lineCode || !stationCode) continue;
  const key = `${lineCode}|${direction}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push({
    code: stationCode,
    sequence: Number(cells[column.Sequence]),
  });
}
for (const [key, stops] of grouped) {
  const lineCode = key.split("|")[0];
  stops.sort((a, b) => a.sequence - b.sequence);
  sequencesByLine.get(lineCode).push(stops.map((stop) => stop.code));
}

const venueByName = new Map();
for (const feature of venues) {
  const properties = feature.properties;
  const key = normZh(properties.venue_name_zh ?? "");
  const box = properties.bbox;
  if (!key || !Array.isArray(box) || box.length !== 4) {
    throw new Error(`車站範圍缺少名稱或範圍：${properties.venue_name_zh}`);
  }
  const lon = (box[0] + box[2]) / 2;
  const lat = (box[1] + box[3]) / 2;
  if (venueByName.has(key)) throw new Error(`車站名稱重覆：${key}`);
  venueByName.set(key, { lat, lon, nameZh: properties.venue_name_zh, nameEn: properties.venue_name_en });
}

for (const station of byCode.values()) {
  const venue = venueByName.get(normZh(station.nameZh));
  if (!venue) throw new Error(`路綫檔的車站在地政總署資料找不到：${station.nameZh}`);
  station.lat = venue.lat;
  station.lon = venue.lon;
  venueByName.delete(normZh(station.nameZh));
}

const racecourse = venueByName.get("馬場");
if (!racecourse) throw new Error("找不到馬場站");
venueByName.delete("馬場");
if (venueByName.size > 0) {
  throw new Error(`有未能對上港鐵路綫的車站：${[...venueByName.keys()].join("、")}`);
}
byCode.set("RAC", {
  code: "RAC",
  nameZh: "馬場",
  nameEn: "Racecourse",
  lines: new Set(["EAL"]),
  lat: racecourse.lat,
  lon: racecourse.lon,
});

const stations = [...byCode.values()]
  .map((station) => ({
    code: station.code,
    nameZh: station.nameZh,
    nameEn: station.nameEn,
    lat: Number(station.lat.toFixed(6)),
    lon: Number(station.lon.toFixed(6)),
    lines: [...station.lines].sort((a, b) => lineOrder.get(a) - lineOrder.get(b)),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

if (stations.length !== 98) throw new Error(`車站數應為 98，實際 ${stations.length}`);
const stationAt = new Map(stations.map((station) => [station.code, station]));

const lines = LINES.map(([code, nameZh, color]) => {
  const sequences = keepSequences(sequencesByLine.get(code));
  const extras = EXTRA_SEGMENTS[code] ?? [];
  const edges = [];
  for (const sequence of sequences) {
    for (let i = 1; i < sequence.length; i += 1) edges.push([sequence[i - 1], sequence[i]]);
  }
  for (const segment of extras) edges.push(segment);
  const paths = chain(edges)
    .map(orient)
    .sort((a, b) => a.join().localeCompare(b.join()));
  const seen = new Set(paths.flat());
  const expected = new Set(stations.filter((station) => station.lines.includes(code)).map((station) => station.code));
  const missing = [...expected].filter((item) => !seen.has(item));
  const extra = [...seen].filter((item) => !expected.has(item));
  if (missing.length || extra.length || seen.size !== EXPECTED_COUNTS[code]) {
    throw new Error(
      `${code} 車站數不對。預期 ${EXPECTED_COUNTS[code]}，路徑上 ${seen.size}。缺 ${missing.join(",")} 多 ${extra.join(",")}`,
    );
  }
  return {
    code,
    nameZh,
    color,
    sequences,
    extraSegments: extras,
    stationCodes: [...seen].sort(),
    paths: paths.map((path) => path.map((stop) => [stationAt.get(stop).lon, stationAt.get(stop).lat])),
    pathCodes: paths,
  };
});

const network = {
  generatedAt: new Date().toISOString(),
  stationCount: stations.length,
  sources: {
    venues: VENUE_URL,
    lines: LINE_URL,
  },
  lines,
  stations,
};

const { mkdir, writeFile } = await import("node:fs/promises");
const output = new URL("../src/data/network.json", import.meta.url);
await mkdir(new URL(".", output), { recursive: true });
await writeFile(output, `${JSON.stringify(network, null, 2)}\n`);

for (const line of lines) {
  console.log(`${line.code} ${line.nameZh} 站 ${line.stationCodes.length} 段 ${line.pathCodes.map((path) => path.join("-")).join(" | ")}`);
}
console.log(`寫入 98 個車站，時間 ${network.generatedAt}`);
