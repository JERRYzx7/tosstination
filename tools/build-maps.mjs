// 產生 index.html 內嵌的地圖資料：簡化 → 統一繞行方向 → 投影成 SVG path。
// 用法：cd tools && npm install && npm run build（會改寫 ../index.html 裡 MAPS 那一段）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3-geo";
import * as topojson from "topojson-client";
import rewind from "@mapbox/geojson-rewind";
import mapshaper from "mapshaper";
import countries from "i18n-iso-countries";
import zhLocale from "i18n-iso-countries/langs/zh.json" with { type: "json" };
import * as OpenCC from "opencc-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(path.join(here, p), "utf8"));
countries.registerLocale(zhLocale);
const cn2tw = OpenCC.Converter({ from: "cn", to: "twp" });
const jp2tw = OpenCC.Converter({ from: "jp", to: "tw" });

// ---------- 共用 ----------

async function simplify(featureCollection, percent) {
  const out = await mapshaper.applyCommands(
    `-i in.json -simplify ${percent}% keep-shapes -o out.json format=geojson`,
    { "in.json": JSON.stringify(featureCollection) });
  return JSON.parse(out["out.json"]);
}

/** 把 MultiPolygon 依條件拆開，只留下符合的多邊形 */
function keepPolygons(feature, keep) {
  const g = feature.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const kept = polys.filter((rings) => {
    const ring = rings[0];
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return keep(lon, lat);
  });
  return { ...feature, geometry: { type: "MultiPolygon", coordinates: kept } };
}

/**
 * d3 要求外圈順時針，否則每個區塊會被畫成填滿整個畫面的方塊。
 * geojson-rewind 是在平面上判斷方向，跨越換日線的多邊形（俄羅斯、斐濟）會判斷錯，
 * 所以再用 d3 的球面面積逐一檢查：面積超過半個地球就是反了，把每個環反轉
 */
function wound(features) {
  const fc = rewind({ type: "FeatureCollection", features }, true);
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const rings of polys) {
      if (d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI) rings.forEach((ring) => ring.reverse());
    }
  }
  return fc;
}

function pathFor(projection) {
  return d3.geoPath(projection).digits(1);
}

const flagOf = (a2) => a2 ? String.fromCodePoint(...[...a2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
const codeOf = (en) => en.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();

// ---------- 台灣：22 縣市，金門、馬祖放左上角小框 ----------

async function buildTaiwan() {
  const W = 600, H = 800;
  const topo = read("node_modules/taiwan-atlas/counties-10t.json");
  const all = await simplify(topojson.feature(topo, topo.objects.counties), 12);
  const isOffshore = (f) => ["金門縣", "連江縣"].includes(f.properties.COUNTYNAME);
  const main = wound(all.features.filter((f) => !isOffshore(f)));
  const projMain = d3.geoMercator().fitExtent([[20, 20], [W - 20, H - 20]], main);

  // 小框：上半馬祖、下半金門
  const inset = { x: 14, y: 14, w: 150, h: 230, label: "金門・馬祖" };
  const boxes = {
    "連江縣": [[inset.x + 12, inset.y + 26], [inset.x + inset.w - 12, inset.y + inset.h / 2 - 6]],
    "金門縣": [[inset.x + 12, inset.y + inset.h / 2 + 6], [inset.x + inset.w - 12, inset.y + inset.h - 12]],
  };

  const regions = all.features.map((f) => {
    const name = f.properties.COUNTYNAME;
    const fc = wound([f]);
    const proj = isOffshore(f) ? d3.geoMercator().fitExtent(boxes[name], fc) : projMain;
    const en = f.properties.COUNTYENG;
    return { n: name, e: en, c: codeOf(en), d: pathFor(proj)(fc) };
  });
  return { label: "台灣", viewBox: [W, H], insets: [inset], regions };
}

// ---------- 日本：47 都道府縣，沖繩放左上角小框；北緯 30° 以南的離島（小笠原、奄美）不畫 ----------

const JAPAN_URL = "https://raw.githubusercontent.com/dataofjapan/land/master/japan.topojson";

async function buildJapan() {
  const W = 800, H = 800;
  // 原始資料不放進 repo，第一次建置時下載
  if (!fs.existsSync(path.join(here, "japan.topojson"))) {
    const res = await fetch(JAPAN_URL);
    if (!res.ok) throw new Error(`下載日本地圖失敗：${res.status}`);
    fs.writeFileSync(path.join(here, "japan.topojson"), await res.text());
  }
  const topo = read("japan.topojson");
  const all = await simplify(topojson.feature(topo, topo.objects.japan), 12);
  const isOkinawa = (f) => f.properties.nam_ja === "沖縄県";

  const main = wound(all.features.filter((f) => !isOkinawa(f)).map((f) => keepPolygons(f, (lon, lat) => lat >= 30)));
  const projMain = d3.geoMercator().fitExtent([[20, 20], [W - 20, H - 20]], main);
  const inset = { x: 14, y: 14, w: 210, h: 170, label: "沖繩" };
  // 沖繩本島與先島群島；大東群島太遠不放
  const okinawa = wound(all.features.filter(isOkinawa).map((f) => keepPolygons(f, (lon) => lon < 129.5)));
  const projOkinawa = d3.geoMercator().fitExtent([[inset.x + 10, inset.y + 26], [inset.x + inset.w - 10, inset.y + inset.h - 10]], okinawa);

  const regions = [...main.features, ...okinawa.features].map((f) => {
    const proj = isOkinawa(f) ? projOkinawa : projMain;
    // "Kyoto Fu" → "Kyoto"，"Hokkai Do" → "Hokkaido"
    const en = f.properties.nam.replace(/^Hokkai Do$/, "Hokkaido").replace(/ (Ken|Fu|To)$/, "");
    return { n: jp2tw(f.properties.nam_ja), e: en, c: codeOf(en), d: pathFor(proj)(wound([f])) };
  });
  return { label: "日本", viewBox: [W, H], insets: [inset], regions };
}

// ---------- 世界：國家，台灣慣用譯名＋國旗；不含南極洲 ----------

// opencc 轉不到台灣慣用譯名，或資料本身沒有 ISO 代碼的
const WORLD_NAMES = {
  TW: "台灣", AU: "澳洲", KR: "南韓", KP: "北韓", AE: "阿拉伯聯合大公國", MT: "馬爾他", ML: "馬利",
  KG: "吉爾吉斯", ME: "蒙特內哥羅", BA: "波士尼亞與赫塞哥維納", DJ: "吉布地", SZ: "史瓦帝尼", BD: "孟加拉",
  TO: "東加", EH: "西撒哈拉", CD: "剛果民主共和國", CG: "剛果共和國", CF: "中非共和國", CZ: "捷克",
  SH: "聖赫勒拿", GS: "南喬治亞島", VG: "英屬維京群島",
};
const NO_ISO = {
  "Kosovo": ["XK", "科索沃"], "Somaliland": [null, "索馬利蘭"], "N. Cyprus": [null, "北賽普勒斯"],
  "Indian Ocean Ter.": [null, "澳屬印度洋領地"], "Siachen Glacier": [null, "錫亞琴冰川"],
};
const EN_ABBR = [
  [/^Dem\. Rep\. Congo$/, "DR Congo"], [/\bIs\.$/, "Islands"], [/\bI\./, "Island"], [/\bRep\./, "Republic"],
  [/\bEq\./, "Equatorial"], [/^S\. /, "South "], [/^N\. /, "North "], [/^W\. /, "Western "], [/^Fr\. /, "French "],
  [/^Br\. /, "British "], [/Herz\.$/, "Herzegovina"], [/^St\. /, "Saint "], [/Gren\.$/, "Grenadines"],
  [/Vin\./, "Vincent"], [/Barb\.$/, "Barbuda"], [/Ter\.$/, "Territory"], [/Geo\./, "Georgia"], [/^Cent\. /, "Central "],
];

async function buildWorld() {
  const W = 1000;
  const topo = read("node_modules/world-atlas/countries-50m.json");
  const all = await simplify(topojson.feature(topo, topo.objects.countries), 15);
  const features = wound(all.features.filter((f) => f.id !== "010"));
  const proj = d3.geoNaturalEarth1().fitWidth(W - 20, features);
  const [[x0, y0], [x1, y1]] = d3.geoPath(proj).bounds(features);
  proj.translate([proj.translate()[0] - x0 + 10, proj.translate()[1] - y0 + 10]);
  const H = Math.ceil(y1 - y0 + 20);

  const regions = features.features.map((f) => {
    const englishRaw = f.properties.name;
    let a2 = f.id ? countries.numericToAlpha2(f.id) : undefined;
    let zh;
    if (NO_ISO[englishRaw]) [a2, zh] = NO_ISO[englishRaw];
    else zh = WORLD_NAMES[a2] ?? cn2tw(countries.getName(a2, "zh") ?? englishRaw);
    const en = EN_ABBR.reduce((s, [re, to]) => s.replace(re, to), englishRaw);
    return { n: zh, e: en, c: codeOf(en), f: flagOf(a2), d: pathFor(proj)(wound([f])) };
  }).filter((r) => r.d);
  return { label: "世界", viewBox: [W, H], insets: [], regions };
}

// ---------- 寫入 index.html ----------

const maps = { taiwan: await buildTaiwan(), japan: await buildJapan(), world: await buildWorld() };
// 投影後每個區塊都不該比整張圖大；比整張圖還大就是繞行方向又反了
for (const m of Object.values(maps)) {
  const [W, H] = m.viewBox;
  for (const r of m.regions) {
    const nums = r.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    if (Math.min(...xs) < -1 || Math.max(...xs) > W + 1 || Math.min(...ys) < -1 || Math.max(...ys) > H + 1) {
      throw new Error(`${m.label} ${r.n} 超出地圖範圍，繞行方向可能反了`);
    }
  }
}
const htmlPath = path.join(here, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const start = "/* <maps> 由 tools/build-maps.mjs 產生，請勿手動修改 */";
const end = "/* </maps> */";
const i = html.indexOf(start), j = html.indexOf(end);
if (i < 0 || j < 0) throw new Error("index.html 找不到 <maps> 標記");
const block = `${start}\nconst MAPS = ${JSON.stringify(maps)};\n${end}`;
fs.writeFileSync(htmlPath, html.slice(0, i) + block + html.slice(j + end.length));
for (const [k, m] of Object.entries(maps)) {
  const bytes = JSON.stringify(m).length;
  console.log(`${k}: ${m.regions.length} regions, viewBox ${m.viewBox.join("×")}, ${(bytes / 1024).toFixed(0)} KB`);
}
