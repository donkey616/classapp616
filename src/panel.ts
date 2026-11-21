import type { Camera } from "./lib/cameras";
import { emptyStationMessage, type LineView } from "./lib/schedule";
import type { Station } from "./network";

const panel = requiredElement<HTMLElement>("#panel");
const body = requiredElement<HTMLElement>("#panel-body");
const closeButton = requiredElement<HTMLButtonElement>("#panel-close");
const hint = requiredElement<HTMLElement>("#hint");

export function onClose(handler: () => void): void {
  closeButton.addEventListener("click", handler);
}

export function hidePanel(): void {
  panel.hidden = true;
}

export function showIntro(): void {
  hint.hidden = false;
  if (window.matchMedia("(max-width: 720px)").matches) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  body.replaceChildren(
    h("h2", {}, ["怎樣使用"]),
    h("p", {}, ["點選地圖上的車站，查看即將到站的列車。轉車站會按路綫分開列出。"]),
    h("p", {}, ["點選交通快拍點，查看該處最新照片。縮小時快拍點會合成一組，放大後才逐點點選。"]),
    h("p", {}, ["某個方向沒有車，或者照片載入失敗時，這裡會直接說明。"]),
  );
}

export function showStationPending(station: Station, names: Map<string, string>): void {
  open();
  body.replaceChildren(stationHeading(station, names), h("p", { class: "quiet" }, ["正在查詢到站班次…"]));
}

export function showStation(
  station: Station,
  names: Map<string, string>,
  views: LineView[],
  onRefresh: () => void,
): void {
  open();
  const blocks = views.map((view) => renderLine(station.code, view));
  body.replaceChildren(
    stationHeading(station, names),
    ...blocks,
    h("div", { class: "actions" }, [button("重新查詢", onRefresh)]),
  );
}

export function showCamera(camera: Camera, imageUrl: string, onRefresh: () => void): void {
  open();
  const status = h("p", { class: "quiet" }, ["正在載入照片…"]);
  const image = document.createElement("img");
  image.className = "photo";
  image.alt = `交通快拍：${camera.description}`;
  image.referrerPolicy = "no-referrer";
  image.src = imageUrl;
  image.addEventListener("load", () => status.remove());
  image.addEventListener("error", () => {
    image.remove();
    status.replaceWith(h("p", { class: "notice" }, ["暫時無法顯示這個快拍點的照片。"]));
  });
  body.replaceChildren(
    h("h2", {}, [camera.description]),
    h("p", { class: "english" }, [[camera.region, camera.district, camera.key].filter(Boolean).join(" · ")]),
    status,
    image,
    h("p", {}, ["照片約每兩分鐘更新。若看到「暫時未能提供服務」，表示運輸署暫時沒有提供這張快拍。"]),
    h("div", { class: "actions" }, [button("重新載入照片", onRefresh)]),
  );
}

function renderLine(stationCode: string, view: LineView): HTMLElement {
  const section = h("section", { class: "line-block" });
  section.append(lineName(view.color, view.lineName));
  if (view.delay) section.append(h("p", { class: "notice" }, ["港鐵表示這條綫目前有延誤。"]));
  if (view.alert) section.append(h("p", { class: "notice" }, [view.alert]));
  if (view.link) {
    const link = h("a", { href: view.link, target: "_blank", rel: "noreferrer" }, ["查看港鐵的特別安排"]);
    section.append(h("p", {}, [link]));
  }
  if (view.bothEmpty) {
    section.append(h("p", {}, [emptyStationMessage(stationCode)]));
  } else {
    for (const direction of view.directions) {
      section.append(h("h3", { class: "direction-title" }, [direction.title]));
      if (direction.trains.length === 0 && direction.empty) {
        section.append(h("p", { class: "quiet" }, [`${direction.title}：${direction.empty}`]));
        continue;
      }
      for (const train of direction.trains) {
        const row = h("div", { class: "train" });
        row.append(h("div", { class: "destination" }, [`往${train.destination}`]));
        row.append(h("div", { class: "when" }, [train.when]));
        const detail = [train.platform, train.clock, ...train.notes].filter(Boolean).join(" · ");
        row.append(h("div", { class: "meta" }, [detail]));
        section.append(row);
      }
    }
  }
  if (view.updatedAt) section.append(h("p", { class: "quiet" }, [`港鐵更新時間 ${view.updatedAt}`]));
  return section;
}

function stationHeading(station: Station, names: Map<string, string>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(
    h("h2", {}, [station.nameZh]),
    h("p", { class: "english" }, [station.nameEn]),
    h("ul", { class: "chips" }, station.lines.map((code) => {
      const line = names.get(code) ?? code;
      const color = names.get(`${code}-color`) ?? "#1c1915";
      return h("li", {}, [swatch(color), line]);
    })),
  );
  return fragment;
}

function lineName(color: string, name: string): HTMLElement {
  return h("h3", { class: "line-name" }, [swatch(color), name]);
}

function swatch(color: string): HTMLElement {
  const mark = h("span", { class: "swatch" });
  mark.style.background = color;
  return mark;
}

function open(): void {
  hint.hidden = true;
  panel.hidden = false;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = h("button", { type: "button", class: "link-button" }, [label]) as HTMLButtonElement;
  node.addEventListener("click", onClick);
  return node;
}

function requiredElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`頁面缺少 ${selector}`);
  return found;
}

function h(tag: string, props: Record<string, string>, children: Array<Node | string> = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
