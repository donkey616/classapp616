import assert from "node:assert/strict";
import test from "node:test";
import { decodeCsv, parseCameraCsv, snapshotUrl } from "../src/lib/cameras.ts";

const sample = [
  "key\tregion\tdistrict\tdescription\teasting\tnorthing\tlatitude\tlongitude\turl",
  "H429F\t香港島\t南區\t香港仔海傍道近魚市場 [H429F]\t1\t2\t22.24845\t114.1505\thttps://tdcctv.data.one.gov.hk/H429F.JPG",
  "BAD\t九龍\t油尖旺\t缺座標\t1\t2\t\t\thttps://tdcctv.data.one.gov.hk/BAD.JPG",
].join("\n");

test("reads traditional Chinese camera rows and skips incomplete ones", () => {
  const bytes = Buffer.from(`\uFEFF${sample}`, "utf16le");
  const text = decodeCsv(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const parsed = parseCameraCsv(text);
  assert.equal(parsed.cameras.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.cameras[0].description, "香港仔海傍道近魚市場 [H429F]");
  assert.equal(parsed.cameras[0].region, "香港島");
  assert.equal(parsed.cameras[0].latitude, 22.24845);
});

test("cache-busts a snapshot within the same minute and changes afterwards", () => {
  const first = snapshotUrl("https://tdcctv.data.one.gov.hk/H429F.JPG", Date.parse("2026-11-21T02:35:10Z"));
  const sameMinute = snapshotUrl("https://tdcctv.data.one.gov.hk/H429F.JPG", Date.parse("2026-11-21T02:35:50Z"));
  const nextMinute = snapshotUrl("https://tdcctv.data.one.gov.hk/H429F.JPG", Date.parse("2026-11-21T02:36:01Z"));
  assert.equal(first, sameMinute);
  assert.notEqual(first, nextMinute);
  assert.match(first, /[?&]t=/);
});
