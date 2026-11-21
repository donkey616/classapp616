import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const from = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
const to = "public/maplibre-gl-worker.mjs";
await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
