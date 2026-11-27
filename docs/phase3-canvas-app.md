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

## Phase 3.3 — 表格優先＋可設定調整次數＋地圖大圖輸出

### A. 表格優先（`canvas-app.html`）
- 自由文本 prompt 換成 HTML 表格：目標公里、容差、起點、終點、每日最多小時、**最多自動調整次數（0–5，預設 3）**；「第 N 日營地」一行一欄，「＋加多一日」動態加欄（上限 13 個營地＝14 日，對應 bridge `MAX_DAYS`）。
- 第一輪計劃由 `buildPlanFromForm()` **直接由表格生成，唔經 AI**：只包含成員揀嘅起點／營地／終點，gazetteer 只係查名錶。徹底解決「AI 塞晒 41 個官方營地入第一輪 → 幾百公里」嘅問題。
- 所有地名經 `findPlace()` 對 gazetteer；唔收录嘅名即時報錯，唔會估座標。

### B. 調整循環護欄
- 上限由 `refineCap()` 讀表格（夾喺 0–5；0 = 唔自動調整），狀態列顯示「第 X／Y 次調整」。達標即停、有停止掣、fallback 唔調整——全部保留。
- AI 只做距離調整：prompt 明言 gazetteer「唔係要去晒嘅清單」、每輪最多 +2 個順路中途點。
- Runtime 護欄：`checkFixed()` 核對用戶固定點順序＋過夜角色冇被 AI 改動；`totalPts>prevPts+2` 或 >24 點即停。AI 違規唔會靜靜雞照計。

### C. 地圖大圖（DTR 生產碼＋Canvas）
- `src/lib/mapLayers.ts`：由 `MapExportDialog` 抽出 `LAYER_META`（含 hm20c LandsD credit），兩邊共用。
- `mapImageExport.ts` `wpLabel()` 優先用 `WaypointMarker.label` ⇒ 輸出圖 CP pill 顯示真實地名。
- `embedBridge.ts`：新訊息 `map:snapshot` → `map:snapshot-result`（PNG dataURL＋尺寸）／`map:snapshot-error`；要已握手、有 `captureMap` dep、單一截圖進行中（busy 即拒）。沿用精確 targetOrigin／origin＋source 核對。
- `App.tsx` `captureMap()`：用目前 segments/waypoints/底圖，`renderMapImage` fit 全路線（+12% margin）1600×1200，回 dataURL。
- Canvas：`route:result` 後 1.5 秒自動 `scheduleSnapshot()`，新面板顯示大圖＋「⬇下載」＋「🔄重新截圖」；90 秒超時有提示。iframe 地圖太細嘅問題由大圖解決。
- 測試：`bridge_embed.test.mjs` +4（成功／冇 dep／未握手／失敗＋busy），`canvas_gazetteer.test.mjs` +2（表格優先＋截圖）。全套 38。

### 部署注意
- 改咗 DTR 生產碼（bridge／App／mapLayers／mapImageExport）⇒ 需要 merge＋Vercel deploy，Canvas 先至攞到圖。
- Canvas 畫面改動靠用戶重新貼 `canvas-app.html`。

## Phase 3.4 — 其他要求自由欄＋爬升上限＋手動 AI 調整（Canvas-only）

用戶反映表格化之後冇位打「唔行樓梯／少啲上落」呢類要求。呢次**淨係改 `canvas-app.html`，冇改生產碼**（bridge 本身已支援 `maxAscentMPerDay`），唔使 Vercel deploy，重新貼 HTML 即生效。

### 新增
- **「其他要求」自由欄 `fNotes`**：打「唔行樓梯、少啲上落、想沿海行」，會帶入 `describeForm()`→`originalRequest`，每次 AI 調整 prompt 都讀到。
- **「每日最多爬升 (m)」欄 `fMaxAscent`**：帶入 `constraints.maxAscentMPerDay`；bridge 會輸出 `max_ascent_per_day` criterion（pass/fail）。
- **回饋循環加爬升檢查**：`maybeRefine` 而家讀 `max_ascent_per_day` criterion，`ascFail` 超標都會觸發自動調整（唔再淨係睇距離）。達標條件 = 距離 OK **且** 爬升 OK。
- **「✨ AI 按其他要求調整」掣 `btnNotesAdjust`**：計完路先出現；就算距離／爬升達標，都可以手動叫 AI 按 notes 執一次路。唔計入自動上限，但共用同一套護欄。
- **共用護欄 `applyAdjust()`**：自動／手動調整都行 +2 點上限、`checkFixed()` 固定點核對、地名核對，通過先至計路。
- **AI 地理常識**：rules 加咗沿海低地營地（大灘／黃石／海下／灣仔…）vs 高地坳位（嶂上／北潭凹／鉛礦坳…）揀點指引。

### 誠實限制
- BRouter profile 固定 `hiking-mountain`，引擎沿真實山徑貼路，**唔保證完全避開樓梯**。「唔行樓梯」係偏好，AI 靠揀低海拔／沿海中途點盡量配合；UI hint 同 AI prompt 都明確講明唔好虛報。用戶要核對結果嘅爬升數字，出發前由領隊確認。
- 測試：`canvas_gazetteer.test.mjs` +1（notes／爬升／手動調整／誠實限制），全套 39。
