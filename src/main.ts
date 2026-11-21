import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type MapGeoJSONFeature,
  type PointLike,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
import "maplibre-gl/dist/maplibre-gl.css";
import { loadCameras, snapshotUrl, type Camera } from "./lib/cameras";
import { lineProblem, parseSchedule, type LineView } from "./lib/schedule";
import { lineDirectory, network, stationNames, type Station } from "./network";
import { hidePanel, onClose, showCamera, showIntro, showStation, showStationPending } from "./panel";
import "./style.css";

const HIDDEN_RAIL_LAYERS = [
  "railway_transit",
  "railway_transit_dashline",
  "railway_service",
  "railway_service_dashline",
  "railway",
  "railway_dashline",
];

const MTR_LAYERS = ["mtr-casing", "mtr-line", "stations", "station-labels"];
const CAMERA_LAYERS = ["camera-clusters", "camera-count", "cameras"];

const summary = requiredElement<HTMLElement>("#summary");
const generated = requiredElement<HTMLElement>("#generated");
const basemapError = requiredElement<HTMLElement>("#basemap-error");
const resetButton = requiredElement<HTMLButtonElement>("#reset");
const mtrToggle = requiredElement<HTMLButtonElement>("#toggle-mtr");
const cameraToggle = requiredElement<HTMLButtonElement>("#toggle-cameras");

const names = Object.fromEntries(stationNames);
const stationsByCode = new Map(network.stations.map((station) => [station.code, station]));
let showMtr = true;
let showCameras = true;
let cameraState: "loading" | "ready" | "error" = "loading";
let cameraCount = 0;
let skippedCameras = 0;
let cameraFeatures: Camera[] | null = null;
let ticket = 0;
let styleReady = false;

generated.textContent = `車站位置讀取於 ${formatHongKong(network.generatedAt)}（香港時間）。`;
renderSummary();
buildLegend();
showIntro();

const map = new MapLibreMap({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [114.15, 22.36],
  zoom: 10,
  maxZoom: 16,
  attributionControl: { compact: true },
  locale: {
    "NavigationControl.ZoomIn": "放大",
    "NavigationControl.ZoomOut": "縮小",
  },
});
map.addControl(new NavigationControl({ showCompass: false }), "top-left");

window.setTimeout(() => {
  if (!styleReady) basemapError.hidden = false;
}, 12_000);

map.on("load", () => {
  styleReady = true;
  basemapError.hidden = true;
  hideBaseRailways();
  addNetwork();
  addCameras();
  showAll(0);
  applyVisibility();
});

map.on("click", (event) => {
  const stationHit = firstFeature(event.point, ["stations"]);
  if (stationHit) {
    const station = stationsByCode.get(textProperty(stationHit, "code"));
    if (station) void openStation(station);
    return;
  }
  const cameraHit = firstFeature(event.point, ["cameras"]);
  if (cameraHit) {
    openCamera(cameraFromFeature(cameraHit));
    return;
  }
  const cluster = firstFeature(event.point, ["camera-clusters"]);
  if (cluster) {
    void expandCluster(cluster);
    return;
  }
  hidePanel();
});

map.on("mousemove", (event) => {
  if (!styleReady) return;
  const hit = firstFeature(event.point, ["stations", "cameras", "camera-clusters"]);
  map.getCanvas().style.cursor = hit ? "pointer" : "";
});

resetButton.addEventListener("click", () => showAll(500));
mtrToggle.addEventListener("click", () => {
  showMtr = !showMtr;
  mtrToggle.setAttribute("aria-pressed", String(showMtr));
  applyVisibility();
});
cameraToggle.addEventListener("click", () => {
  showCameras = !showCameras;
  cameraToggle.setAttribute("aria-pressed", String(showCameras));
  applyVisibility();
});
onClose(() => hidePanel());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hidePanel();
});

void loadCameras()
  .then((result) => {
    cameraState = "ready";
    cameraCount = result.cameras.length;
    skippedCameras = result.skipped;
    cameraFeatures = result.cameras;
    addCameras();
    renderSummary();
  })
  .catch(() => {
    cameraState = "error";
    renderSummary();
  });

function addNetwork(): void {
  if (map.getSource("mtr")) return;
  map.addSource("mtr", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: network.lines.flatMap((line) =>
        line.paths.map((coordinates) => ({
          type: "Feature" as const,
          properties: { color: line.color, name: line.nameZh },
          geometry: { type: "LineString" as const, coordinates },
        })),
      ),
    },
  });
  map.addLayer({
    id: "mtr-casing",
    type: "line",
    source: "mtr",
    paint: { "line-color": "#fffdf8", "line-width": 6.5, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "mtr-line",
    type: "line",
    source: "mtr",
    paint: { "line-color": ["get", "color"], "line-width": 3.4 },
  });
  map.addSource("stations", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: network.stations.map((station) => ({
        type: "Feature" as const,
        properties: {
          code: station.code,
          nameZh: station.nameZh,
          color: lineDirectory.get(`${station.lines[0]}-color`) ?? "#1c1915",
          lineCount: station.lines.length,
        },
        geometry: { type: "Point" as const, coordinates: [station.lon, station.lat] },
      })),
    },
  });
  map.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 9],
      "circle-color": "#fffdf8",
      "circle-stroke-width": ["case", [">", ["get", "lineCount"], 1], 3, 2.5],
      "circle-stroke-color": ["case", [">", ["get", "lineCount"], 1], "#1c1915", ["get", "color"]],
    },
  });
  map.addLayer({
    id: "station-labels",
    type: "symbol",
    source: "stations",
    minzoom: 12,
    layout: {
      "text-field": ["get", "nameZh"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-offset": [0, 0.85],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": "#1c1915",
      "text-halo-color": "#f7f4ee",
      "text-halo-width": 1.3,
    },
  });
}

function addCameras(): void {
  if (!styleReady || !cameraFeatures || map.getSource("cameras")) return;
  map.addSource("cameras", {
    type: "geojson",
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 13,
    data: {
      type: "FeatureCollection",
      features: cameraFeatures.map((camera) => ({
        type: "Feature" as const,
        properties: {
          key: camera.key,
          region: camera.region,
          district: camera.district,
          description: camera.description,
          url: camera.url,
        },
        geometry: { type: "Point" as const, coordinates: [camera.longitude, camera.latitude] },
      })),
    },
  });
  const before = map.getLayer("stations") ? "stations" : undefined;
  map.addLayer({
    id: "camera-clusters",
    type: "circle",
    source: "cameras",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#9a3412",
      "circle-radius": ["step", ["get", "point_count"], 14, 30, 18, 100, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fffdf8",
    },
  }, before);
  map.addLayer({
    id: "camera-count",
    type: "symbol",
    source: "cameras",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
    },
    paint: { "text-color": "#fffdf8" },
  }, before);
  map.addLayer({
    id: "cameras",
    type: "circle",
    source: "cameras",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": 5.5,
      "circle-color": "#c2410c",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#fffdf8",
    },
  }, before);
  applyVisibility();
}

function hideBaseRailways(): void {
  for (const id of HIDDEN_RAIL_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
}

function applyVisibility(): void {
  const mtrVisibility = showMtr ? "visible" : "none";
  const cameraVisibility = showCameras ? "visible" : "none";
  for (const id of MTR_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", mtrVisibility);
  }
  for (const id of CAMERA_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", cameraVisibility);
  }
}

function showAll(duration: number): void {
  const bounds = new LngLatBounds();
  for (const station of network.stations) bounds.extend([station.lon, station.lat]);
  map.fitBounds(bounds, { padding: 40, maxZoom: 11, duration });
}

async function openStation(station: Station): Promise<void> {
  const mine = ++ticket;
  focusPoint(station.lon, station.lat);
  showStationPending(station, lineDirectory);
  const views = await Promise.all(station.lines.map((code) => loadLine(code, station.code)));
  if (mine !== ticket) return;
  showStation(station, lineDirectory, views, () => {
    void openStation(station);
  });
}

function openCamera(camera: Camera, force = false): void {
  ticket += 1;
  focusPoint(camera.longitude, camera.latitude);
  showCamera(camera, snapshotUrl(camera.url, Date.now(), force ? 1 : 60_000), () => openCamera(camera, true));
}

async function loadLine(lineCode: string, stationCode: string): Promise<LineView> {
  const line = network.lines.find((item) => item.code === lineCode);
  const name = line?.nameZh ?? lineCode;
  const color = line?.color ?? "#1c1915";
  const url = new URL("https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php");
  url.searchParams.set("line", lineCode);
  url.searchParams.set("sta", stationCode);
  url.searchParams.set("lang", "TC");
  try {
    const response = await fetch(url);
    if (response.status === 429) return lineProblem(lineCode, name, color, "港鐵查詢過於頻密，請稍候再試。");
    if (!response.ok) return lineProblem(lineCode, name, color, "暫時連不上港鐵到站服務，請稍後再試。");
    return parseSchedule(lineCode, name, color, stationCode, await response.json(), names);
  } catch {
    return lineProblem(lineCode, name, color, "暫時連不上港鐵到站服務，請稍後再試。");
  }
}

function focusPoint(longitude: number, latitude: number): void {
  const narrow = window.matchMedia("(max-width: 720px)").matches;
  map.easeTo({
    center: [longitude, latitude],
    zoom: Math.max(map.getZoom(), narrow ? 12.5 : 13),
    padding: narrow ? { bottom: 240, top: 48 } : { right: 420, top: 24, left: 24, bottom: 24 },
    duration: 450,
  });
}

async function expandCluster(feature: MapGeoJSONFeature): Promise<void> {
  const source = map.getSource("cameras");
  if (!(source instanceof GeoJSONSource)) return;
  const clusterId = Number(feature.properties?.cluster_id);
  if (!Number.isFinite(clusterId) || feature.geometry.type !== "Point") return;
  const zoom = await source.getClusterExpansionZoom(clusterId);
  map.easeTo({
    center: feature.geometry.coordinates as [number, number],
    zoom,
  });
}

function firstFeature(point: PointLike, layers: string[]): MapGeoJSONFeature | undefined {
  const present = layers.filter((id) => {
    if (!map.getLayer(id)) return false;
    return map.getLayoutProperty(id, "visibility") !== "none";
  });
  if (present.length === 0) return undefined;
  return map.queryRenderedFeatures(point, { layers: present })[0];
}

function textProperty(feature: MapGeoJSONFeature, key: string): string {
  const value = feature.properties?.[key];
  return value == null ? "" : String(value);
}

function cameraFromFeature(feature: MapGeoJSONFeature): Camera {
  const [longitude, latitude] = feature.geometry.type === "Point"
    ? feature.geometry.coordinates as [number, number]
    : [0, 0];
  return {
    key: textProperty(feature, "key"),
    region: textProperty(feature, "region"),
    district: textProperty(feature, "district"),
    description: textProperty(feature, "description"),
    url: textProperty(feature, "url"),
    longitude,
    latitude,
  };
}

function renderSummary(): void {
  const stations = `${network.stations.length} 個港鐵站`;
  if (cameraState === "loading") {
    summary.textContent = `${stations}。正在讀取交通快拍…`;
    return;
  }
  if (cameraState === "error") {
    summary.textContent = `${stations}。暫時無法取得交通快拍位置，地圖上沒有快拍點。`;
    return;
  }
  const skipped = skippedCameras > 0 ? `，另外 ${skippedCameras} 筆缺了座標，沒有放上地圖` : "";
  summary.textContent = `${stations} · ${cameraCount} 個交通快拍點${skipped}`;
}

function buildLegend(): void {
  const legend = document.querySelector("#legend");
  if (!legend) return;
  const title = document.createElement("p");
  title.textContent = "港鐵";
  const list = document.createElement("ul");
  for (const line of network.lines) {
    const item = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = "swatch";
    mark.style.background = line.color;
    item.append(mark, document.createTextNode(line.nameZh));
    list.append(item);
  }
  legend.replaceChildren(title, list);
}

function requiredElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`頁面缺少 ${selector}`);
  return found;
}

function formatHongKong(iso: string): string {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
