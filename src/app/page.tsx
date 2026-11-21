"use client";

import { useEffect } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export default function Page() {
  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;
    void import("../main").then((mod) => {
      if (cancelled) return;
      cleanup = mod.mountMap();
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return (
    <div id="app">
      <header>
        <div>
          <h1>香港智慧城市地圖</h1>
          <p id="summary">正在準備地圖…</p>
          <details>
            <summary>資料來源</summary>
            <ul>
              <li>底圖是 OpenFreeMap 的 Positron，地圖資料來自 OpenStreetMap。</li>
              <li>車站位置用地政總署港鐵站範圍的中心。</li>
              <li>路綫和站名來自港鐵公開數據。路線形狀沿 OpenStreetMap 的實際路軌彎行。到站班次由伺服器共用，大約每分鐘才向港鐵查詢一次。</li>
              <li>地圖上移動的列車沒有 GPS。位置是用實時到站時間，沿路軌推算出來的。</li>
              <li>交通快拍位置和照片來自運輸署，照片約每兩分鐘更新。</li>
              <li>路線顏色是方便閱讀的慣用色，不是到站接口的欄位。</li>
            </ul>
            <p id="generated"></p>
          </details>
        </div>
        <div className="toggles">
          <button id="reset" type="button">全港</button>
          <button id="toggle-mtr" type="button" className="toggle" aria-pressed="true">港鐵網絡</button>
          <button id="toggle-trains" type="button" className="toggle" aria-pressed="true">行駛中列車</button>
          <button id="toggle-cameras" type="button" className="toggle" aria-pressed="true">交通快拍</button>
        </div>
      </header>
      <div id="stage">
        <div id="map" role="region" aria-label="香港地圖"></div>
        <div id="basemap-error" role="alert" hidden>
          底圖暫時載入失敗。OpenFreeMap 沒有回應，請稍後重新整理。
        </div>
        <div id="legend"></div>
        <p id="hint">點車站查班次，點快拍點看照片，點行駛中的列車看下一站。</p>
        <aside id="panel" hidden aria-label="所選地點">
          <div className="panel-bar">
            <button id="panel-close" type="button">關閉</button>
          </div>
          <div id="panel-body"></div>
        </aside>
      </div>
    </div>
  );
}
