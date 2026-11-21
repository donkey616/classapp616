import networkFile from "./data/network.json";

export type Station = {
  code: string;
  nameZh: string;
  nameEn: string;
  lat: number;
  lon: number;
  lines: string[];
};

export type RailLine = {
  code: string;
  nameZh: string;
  color: string;
  paths: number[][][];
  tracks?: number[][][];
  sequences: string[][];
  extraSegments: string[][];
  stationCodes: string[];
};

type NetworkFile = {
  generatedAt: string;
  lines: RailLine[];
  stations: Station[];
};

export const network = networkFile as NetworkFile;

export const stationNames = new Map(network.stations.map((station) => [station.code, station.nameZh]));

export const lineDirectory = new Map<string, string>();
for (const line of network.lines) {
  lineDirectory.set(line.code, line.nameZh);
  lineDirectory.set(`${line.code}-color`, line.color);
}
