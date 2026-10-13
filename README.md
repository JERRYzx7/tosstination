# Tosstination ✈ 飛鏢旅行

把紙飛機當成飛鏢，拉弓射出後，飛機降落在地圖上的哪裡，下一趟旅行就去哪裡。

**▶ 直接玩：https://jerryzx7.github.io/tosstination/**

- 三張地圖：台灣（縣市）、日本（都道府縣）、世界（國家）
- 按住畫面任一處往後拉，虛線會畫出前段的拋物線；拉越久地圖越模糊，只能憑感覺
- 每一輪的風向、風速都不同，會把飛機吹偏
- 落在海上會緊急改降到最近的陸地，最後拿到一張登機證
- 滑鼠和手指都能玩，不需要安裝，也不需要後端

整個遊戲只有一個 `index.html`，CSS、JavaScript 和地圖都在裡面。

## 重新產生地圖

地圖資料由 `tools/build-maps.mjs` 預先簡化、投影成 SVG path，再寫進 `index.html`：

```sh
cd tools
npm install
npm run build
```

## 地圖資料來源

| 地圖 | 來源 | 授權 |
|---|---|---|
| 台灣 | [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas)（內政部國土測繪中心） | MIT |
| 日本 | [dataofjapan/land](https://github.com/dataofjapan/land)（國土數值情報） | 建置時下載，不隨 repo 散布 |
| 世界 | [world-atlas](https://github.com/topojson/world-atlas)（Natural Earth） | ISC／公有領域 |

中文國名來自 [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries)，用 [opencc-js](https://github.com/nk2028/opencc-js) 轉成台灣用語，再手動修正部分譯名。
