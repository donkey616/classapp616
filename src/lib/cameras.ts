export type Camera = {
  key: string;
  region: string;
  district: string;
  description: string;
  latitude: number;
  longitude: number;
  url: string;
};

export const CAMERA_CSV_URL =
  "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv";

export function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }
  return new TextDecoder("utf-8").decode(buffer);
}

export function parseCameraCsv(text: string): { cameras: Camera[]; skipped: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { cameras: [], skipped: 0 };
  const header = lines[0].split("\t").map((cell) => cell.trim());
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  for (const name of ["key", "region", "district", "description", "latitude", "longitude", "url"]) {
    if (index[name] === undefined) throw new Error(`快拍位置檔缺少欄位 ${name}`);
  }
  const cameras: Camera[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const key = cells[index.key]?.trim() ?? "";
    const latitudeText = cells[index.latitude]?.trim() ?? "";
    const longitudeText = cells[index.longitude]?.trim() ?? "";
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    const url = cells[index.url]?.trim() || (key ? `https://tdcctv.data.one.gov.hk/${key}.JPG` : "");
    if (!key || !url || latitudeText === "" || longitudeText === "" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      skipped += 1;
      continue;
    }
    cameras.push({
      key,
      region: cells[index.region]?.trim() ?? "",
      district: cells[index.district]?.trim() ?? "",
      description: cells[index.description]?.trim() || key,
      latitude,
      longitude,
      url,
    });
  }
  return { cameras, skipped };
}

export function snapshotUrl(url: string, now = Date.now(), bucketMs = 60_000): string {
  const token = String(Math.floor(now / bucketMs));
  const parsed = new URL(url);
  parsed.searchParams.set("t", token);
  return parsed.toString();
}

export async function loadCameras(fetchImpl: typeof fetch = fetch): Promise<{ cameras: Camera[]; skipped: number }> {
  const response = await fetchImpl(CAMERA_CSV_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`快拍位置檔回應 ${response.status}`);
  const text = decodeCsv(await response.arrayBuffer());
  const parsed = parseCameraCsv(text);
  if (parsed.cameras.length === 0) throw new Error("快拍位置檔沒有可用的點");
  return parsed;
}
