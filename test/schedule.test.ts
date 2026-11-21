import assert from "node:assert/strict";
import test from "node:test";
import { arrivalText, emptyStationMessage, parseSchedule } from "../src/lib/schedule.ts";

const names = {
  CHW: "柴灣",
  KET: "堅尼地城",
  POA: "寶琳",
  RAC: "馬場",
  LOW: "羅湖",
};

test("shows minutes, arriving now, and the Chinese destination", () => {
  const view = parseSchedule("ISL", "港島綫", "#007DC5", "CEN", {
    status: 1,
    message: "successful",
    isdelay: "N",
    curr_time: "2026-11-21 10:35:02",
    data: {
      "ISL-CEN": {
        UP: [{ seq: "1", dest: "CHW", plat: "3", ttnt: "2", time: "2026-11-21 10:37:02", valid: "Y" }],
        DOWN: [{ seq: "1", dest: "KET", plat: "4", ttnt: "0", time: "2026-11-21 10:35:02", valid: "Y" }],
      },
    },
  }, names);

  assert.equal(view.bothEmpty, false);
  assert.equal(view.alert, null);
  assert.equal(view.updatedAt, "10:35");
  assert.equal(view.directions[0].title, "往柴灣");
  assert.equal(view.directions[0].trains[0].destination, "柴灣");
  assert.equal(view.directions[0].trains[0].when, "約 2 分鐘");
  assert.equal(view.directions[0].trains[0].platform, "月台 3");
  assert.equal(view.directions[1].trains[0].when, "即將到站");
});

test("keeps one empty direction at a terminus", () => {
  const view = parseSchedule("TCL", "東涌綫", "#F7941D", "TUC", {
    status: 1,
    curr_time: "2026-11-21 10:36:00",
    data: { "TCL-TUC": { UP: [], DOWN: [{ seq: "1", dest: "HOK", plat: "1", ttnt: "9", time: "2026-11-21 10:40:00", valid: "Y" }] } },
  }, { HOK: "香港" });

  assert.equal(view.bothEmpty, false);
  assert.equal(view.directions[0].empty, "這個方向暫時沒有班次。");
  assert.equal(view.directions[1].trains[0].destination, "香港");
  assert.equal(view.directions[1].trains[0].when, "約 4 分鐘");
});

test("explains a station with no trains, including the racecourse", () => {
  const view = parseSchedule("EAL", "東鐵綫", "#53B7E8", "RAC", {
    status: 1,
    message: "successful",
    data: { "EAL-RAC": { curr_time: "-", sys_time: "-" } },
  }, names);

  assert.equal(view.bothEmpty, true);
  assert.equal(view.updatedAt, null);
  assert.match(emptyStationMessage("RAC"), /賽馬日/);
  assert.match(emptyStationMessage("CEN"), /尾班車/);
});

test("shows an East Rail via-racecourse departure", () => {
  const view = parseSchedule("EAL", "東鐵綫", "#53B7E8", "SHT", {
    status: 1,
    isdelay: "Y",
    curr_time: "2026-11-21 10:37:00",
    data: {
      "EAL-SHT": {
        UP: [{ seq: "1", dest: "LOW", plat: "2", ttnt: "3", time: "2026-11-21 10:40:00", valid: "N", timeType: "D", route: "RAC" }],
        DOWN: [],
      },
    },
  }, names);
  const train = view.directions[0].trains[0];
  assert.equal(view.delay, true);
  assert.deepEqual(train.notes, ["開出", "經馬場", "這班資料未確定"]);
  assert.equal(train.destination, "羅湖");
});

test("shows the MTR alert and keeps only a safe link", () => {
  const view = parseSchedule("EAL", "東鐵綫", "#53B7E8", "LOW", {
    status: 0,
    message: "LOW station is suspended",
    url: "https://www.mtr.com.hk/alert/example.html",
  }, names);
  assert.equal(view.alert, "港鐵回覆：LOW station is suspended");
  assert.equal(view.link, "https://www.mtr.com.hk/alert/example.html");
  assert.equal(view.directions.length, 0);

  const blocked = parseSchedule("EAL", "東鐵綫", "#53B7E8", "LOW", {
    status: 0,
    message: "停止服務",
    url: "javascript:alert(1)",
  }, names);
  assert.equal(blocked.link, null);
});

test("arrival text uses Hong Kong train time minus the response clock", () => {
  const now = "2026-11-21 10:35:02";
  assert.equal(arrivalText("2026-11-21 10:35:02", now), "即將到站");
  assert.equal(arrivalText("2026-11-21 10:34:20", now), "即將到站");
  assert.equal(arrivalText("2026-11-21 10:47:02", now), "約 12 分鐘");
  assert.equal(arrivalText("", now), "時間未提供");
  assert.equal(arrivalText("2026-11-21 10:47:02", "-"), "時間未提供");
  assert.equal(arrivalText("2026-11-21T10:47:02Z", now), "時間未提供");
});
