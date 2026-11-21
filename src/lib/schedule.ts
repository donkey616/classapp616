export type TrainRow = {
  destination: string;
  platform: string;
  when: string;
  clock: string;
  notes: string[];
};

export type DirectionView = {
  title: string;
  empty: string | null;
  trains: TrainRow[];
};

export type LineView = {
  lineCode: string;
  lineName: string;
  color: string;
  alert: string | null;
  link: string | null;
  delay: boolean;
  updatedAt: string | null;
  bothEmpty: boolean;
  directions: DirectionView[];
};

const DIRECTION_TITLES: Record<string, { UP: string; DOWN: string }> = {
  AEL: { UP: "往機場／博覽館", DOWN: "往香港" },
  TCL: { UP: "往東涌", DOWN: "往香港" },
  TML: { UP: "往屯門", DOWN: "往烏溪沙" },
  TKL: { UP: "往寶琳／康城", DOWN: "往北角／調景嶺" },
  EAL: { UP: "往羅湖／落馬洲", DOWN: "往金鐘" },
  SIL: { UP: "往海怡半島", DOWN: "往金鐘" },
  TWL: { UP: "往荃灣", DOWN: "往中環" },
  ISL: { UP: "往柴灣", DOWN: "往堅尼地城" },
  KTL: { UP: "往調景嶺", DOWN: "往黃埔" },
  DRL: { UP: "往欣澳", DOWN: "往迪士尼" },
};

type Payload = {
  status?: number | string;
  message?: string;
  url?: string;
  isdelay?: string;
  Isdelay?: string;
  curr_time?: string;
  sys_time?: string;
  data?: Record<string, {
    UP?: TrainPayload[];
    DOWN?: TrainPayload[];
    curr_time?: string;
    sys_time?: string;
  }>;
};

type TrainPayload = {
  seq?: string;
  dest?: string;
  plat?: string;
  ttnt?: string;
  time?: string;
  valid?: string;
  timeType?: string;
  timetype?: string;
  route?: string;
};

export function emptyStationMessage(stationCode: string): string {
  if (stationCode === "RAC") {
    return "這個站暫時沒有即將到站的班次。馬場站通常只在賽馬日提供服務。";
  }
  return "這個站暫時沒有即將到站的班次。可能是尾班車已開出，或暫時沒有載客。";
}

export function lineProblem(lineCode: string, lineName: string, color: string, alert: string): LineView {
  return {
    lineCode,
    lineName,
    color,
    alert,
    link: null,
    delay: false,
    updatedAt: null,
    bothEmpty: false,
    directions: [],
  };
}

export function parseSchedule(
  lineCode: string,
  lineName: string,
  color: string,
  stationCode: string,
  payload: unknown,
  names: Record<string, string>,
): LineView {
  const body = isRecord(payload) ? (payload as Payload) : null;
  if (!body) return lineProblem(lineCode, lineName, color, "暫時無法讀取這條綫的班次。");

  const failed = Number(body.status) === 0;
  const link = safeHttpUrl(body.url);
  const updatedAt = clockStamp(body.curr_time) ?? clockStamp(body.sys_time);
  const base = {
    lineCode,
    lineName,
    color,
    link,
    delay: body.isdelay === "Y" || body.Isdelay === "Y",
    updatedAt,
  };

  if (failed) {
    const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : "";
    return {
      ...base,
      alert: message ? `港鐵回覆：${message}` : "港鐵沒有提供這條綫的班次。",
      bothEmpty: false,
      directions: [],
    };
  }

  const node = body.data?.[`${lineCode}-${stationCode}`];
  const currentTime = usableStamp(body.curr_time)
    ?? usableStamp(body.sys_time)
    ?? usableStamp(node?.curr_time)
    ?? usableStamp(node?.sys_time);
  const titles = DIRECTION_TITLES[lineCode] ?? { UP: "上行", DOWN: "下行" };
  const directions = (["UP", "DOWN"] as const).map((side) => {
    const trains = [...(node?.[side] ?? [])].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    return {
      title: titles[side],
      empty: trains.length === 0 ? "這個方向暫時沒有班次。" : null,
      trains: trains.map((train) => toRow(train, names, currentTime)),
    };
  });
  const bothEmpty = directions.every((direction) => direction.trains.length === 0);

  return {
    ...base,
    alert: null,
    bothEmpty,
    directions,
  };
}

function toRow(train: TrainPayload, names: Record<string, string>, currentTime: string | null): TrainRow {
  const destinationCode = train.dest?.trim() || "";
  const notes: string[] = [];
  const timeType = train.timeType ?? train.timetype;
  if (timeType === "A") notes.push("到達");
  if (timeType === "D") notes.push("開出");
  if (train.route === "RAC" && destinationCode !== "RAC") notes.push("經馬場");
  if (train.valid === "N") notes.push("這班資料未確定");
  return {
    destination: destinationCode ? (names[destinationCode] ?? destinationCode) : "目的地未提供",
    platform: train.plat ? `月台 ${train.plat}` : "月台未提供",
    when: arrivalText(train.time, currentTime ?? undefined),
    clock: clockStamp(train.time) ?? "",
    notes,
  };
}

const HONG_KONG_OFFSET = "+08:00";

export function arrivalText(trainTime: string | undefined, currentTime: string | undefined): string {
  const trainMs = hongKongTimeMs(trainTime);
  const currentMs = hongKongTimeMs(currentTime);
  if (trainMs == null || currentMs == null) return "時間未提供";
  const minutes = Math.round((trainMs - currentMs) / 60_000);
  if (minutes <= 0) return "即將到站";
  return `約 ${minutes} 分鐘`;
}

export function hongKongTimeMs(value: string | undefined): number | null {
  if (!value || value === "-") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}${HONG_KONG_OFFSET}`);
  return Number.isNaN(parsed) ? null : parsed;
}

function usableStamp(value: string | undefined): string | null {
  return hongKongTimeMs(value) == null ? null : value!.trim();
}

function clockStamp(value: string | undefined): string | null {
  if (!value || value === "-") return null;
  const match = value.match(/(\d{2}:\d{2})(?::\d{2})?/);
  return match ? match[1] : null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
