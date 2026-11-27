# Phase 3.1 — Canvas 成員畫面：已核實地點表＋距離回饋循環

> 對應使用者投訴：「AI 想出嚟數值唔夠、唔識繞到夠數、次次最短距離；mark 位唔啱，連營地都 mark 錯。」

## 兩個根因
1. **AI 估座標**：舊 prompt 寫「如果唔確定座標，用最接近嘅估計」，導致營地 mark 錯。
2. **一次性規劃**：AI 俾幾個點 → BRouter 行最短路径 → 出結果；冇「計完唔夠數再繞路」嘅回饋循環。

## 修正
### 1. 已核實地點表（gazetteer）
- 內建 46 個地点：41 個漁護署官方營地（來源：`playerkousas-rgb/hkcamping` 嘅 `data/auto/afcd-campsites.json`，CSDI 官方 GeoJSON）＋ 5 個起訖點（北潭涌、上窰、北潭凹、黃石碼頭、海下，來源 Wikidata/Wikipedia/Wikimedia）。
- AI **只准輸出地点名**，唔准輸出 lat/lon；Canvas 按名從 gazetteer 填入座標。
- 未收录地点 → 拒絕並提示，唔會靜默 geocode。
- 確認面板顯示每個点嘅座標同來源。

### 2. 距離回饋循環
```
AI 出路線（只用地點名）→ 用戶確認 → DTR 真實 BRouter 計路
   → 若 |真實距離 - 目標| > 容差 且未達 3 round：
        將真實距離＋每日距離回俾 AI → AI 加/減中途點繞路 → 再計
   → 達標 / 到上限 / 用戶停止 / fallback → 停
```
- 最多 `MAX_REFINE_ROUNDS = 3`，有「停止自動調整」掣。
- 保留用戶指定營地／起終點；只加減可選中途點。
- 若 `fallbackUsed`（直線備援）不自動繞路，要求人手檢查。
- 容差預設 2 km（可喺 constraints 改）；呢個係規劃目標容差，唔係安全標準。

## 安全把關（不變）
- 結果永遠 `humanReviewRequired`、只供參考、領隊核實。
- fallback 永不 pass；唔虛構安全標準。
- apiKey 留空，Canvas 免費 fetch 攔截；冇 secrets。

## 測試
- `scripts/canvas_gazetteer.test.mjs`：驗證 gazetteer 已注入、關鍵營地座標符合 AFCD 官方、prompt 禁止估座標、有回饋循環。
- `npm test` 包含呢個 suite。

## 部署
- `canvas-app.html` 係 Canvas artifact，已入 `.vercelignore`，唔會 deploy 上 DTR 生產。
- 用戶將新版 `canvas-app.html` 貼入 Gemini Canvas 即可。

---

## Phase 3.2 — 修正「 INVALID_PLAN 欠 stage」＋「睇唔到 CP 名／Excel 空名」

### A. stage 驗證放寬（`src/bridge/contract.ts`）
- 舊版：只要 `stages` 非空，就要求每一對相鄰點都有 stage，否则 `INVALID_PLAN 欠 stage 定義`。AI 自動加中途點後 stages 必然唔齊 → 成日失敗。
- 新版：先用 `overnight` role 推斷日界（對插入中途點稳健）；`stages` 只係可選 override，缺漏嘅 leg 用推斷補上，唔再拒絕。
- 測試：`bridge_contract.test.mjs` 加「部分 stages」「加中途點後 stages 唔齊」兩個 case。

### B. DTR 保留 CP 地名（`types`／`useRouteManager`／`embedBridge`）
- `WaypointMarker` 加 `label?`；`planRoute` 接收帶 label 嘅點並寫入 waypoint；bridge 唔再丟 label。
- 測試：`bridge_embed.test.mjs` 加「label 帶入 planRoute」case。

### C. Excel／CSV 自動填地理名稱（`ElevationChart`／`useItineraryData`）
- `wpNames` 由 `waypoints[i].label` 預填（路線 CP 組合改變時重置，仍可人手改）；行程表 `name` 亦優先用 label。
- 效果：导出嘅「地理名稱(出發/到達)」同「起點／終點」唔再空。

### D. Canvas 顯示 CP 清單（`canvas-app.html`）
- 結果面板加「📍 AI 規劃 CP 清單」（名／角色／座標）同「🧭 每段」（起訖地名／日／距離／貼路）。
- prompt 要求保持過夜營地 `role="overnight"`、唔好寫唔齊全嘅 stages。

### 部署注意
- 呢次改咗 DTR 生產碼（bridge／行程表），**需要 merge＋Vercel deploy** 先至令嵌入嘅 DTR 識填名。
- Canvas 畫面改動則靠用戶重新貼 `canvas-app.html`。
