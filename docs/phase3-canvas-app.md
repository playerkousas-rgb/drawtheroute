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

## Phase 3.5 — 起終點可留空 → AI 補位／全部留空 AI 自由發揮（Canvas-only）

用戶問「起點終點係咪 fix 死咗喺北潭涌」。答案：唔係锁死，只係預填咗做例子；但留空會報錯。呢次改成**真正可留空**，並加 AI 補位路徑。**淨係改 `canvas-app.html`，冇改生產碼**，重新貼 HTML 即生效。

### 改動
- **起點／終點／目標公里預設留空**（placeholder 提示「留空由 AI 揀」），唔再預填北潭涌；營地欄由兩行預填改為一行空白提示。
- **`runPlan()` 分流**：起點＋終點都填咗 → 純表格生成（`buildPlanFromForm`，唔經 AI）；是但一個留空 → `runAiPlan()`。
- **`runAiPlan()`**：將用戶已填嘅營地／公里／上限／其他要求砌成 spec，叫 AI 生成完整計劃；留空嘅由 AI 按已填資料揀，**全部留空 = AI 自由發揮**。生成後：
  - 核對 AI 揀嘅名全部喺 gazetteer（`resolveNamePlan`），座標一律由系統按名填入，AI 唔准估。
  - `checkFixed()` 核對 AI 有冇尊重用戶填咗嘅起終點／營地；唔尊重即拒。
  - `skeletonFromPlan()` 抽出起點＋過夜營地＋終點做固定點骨架，之後 refine 只加減可選中途點。
  - 用戶表格嘅約束（容差／每日小時／每日爬升／目標公里）覆蓋 AI 輸出，係權威。
  - 守 24 點上限。
- **AI rules 拆細**：`PLACE_RULES`（共用：gazetteer 查名、JSON 格式、overnight、地理常識、唔好塞晒所有營地）＋`BASE_RULES`（調整：每輪 +2）＋`GEN_RULES`（生成：尊重已填、留空補位、全空自由發揮）。`callGemini(userText, rules)` 食 rules 參數。
- 生成嘅計劃照樣行確認面板（座標來源顯示 AFCD 官方／已核實），用戶確認先至計路。

### 安全／誠實
- AI 自由發揮都係用地點表揀名，唔會虛構座標；「唔好塞晒所有營地」喺 PLACE_RULES＋GEN_RULES 双重聲明。
- 用戶填咗嘅點係固定點，AI 補位唔准郁；可選中途點先至俾 refine 加減。
- 測試：`canvas_gazetteer.test.mjs` +1（留空→AI／自由發揮／骨架／固定點核對），全套 40。

## Phase 3.6 — AI 網上座標自由畫路；營地守 AFCD 官方（Canvas-only）

用戶指出嚴重問題：地點表 46 點有 41 個係營地，AI 唯一「畫路」動作就係塞營地做 CP，根本唔係自由畫路。用戶拍板：**俾 AI 喺網上搵有座標嘅地點畫路**（DTR bridge 接受任意合法座標），**過夜營地仍然守 AFCD 官方**（非官方過夜不安全又不合法）。**淨係改 `canvas-app.html`，冇改生產碼。**

### 改動
- **`resolveNamePlan` 重寫**：
  - `overnight`（過夜營地）→ 必須係地點表 `kind==='campsite'` 嘅 AFCD 官方營地，用官方座標；AI 唔准俾座標。唔係官方營地即拒。
  - `start／finish／cp`（畫路點）→ 精確官方名（`findPlaceExact`）用官方座標；否則接受 AI 網上搵到嘅真實座標（`validAiCoord` 限 HK 範圍，擋離譜 hallucination），標記 `_source:'AI 網上查找'`、`_aiFound:true`；最後先至模糊官方名。
- **`findPlaceExact`（新）**：精確匹配，唔做模糊 substring——避免「西灣山」呢類山峰名被 `findPlace` 誤配去「西灣營地」而用錯座標。
- **`validAiCoord`（新）**：AI 座標必須喺 HK 範圍（lat 22.0–22.65、lon 113.8–114.55）。
- **`checkFixed` 過夜角色檢查重寫**：每個固定營地必須仍然有一個 `role="overnight"` 嘅點，唔係淨係名似——避免畫路山峰名（模糊匹配到營地）被誤判做「改咗營地角色」。
- **AI rules 重寫**：`PLACE_RULES` 分開【過夜營地】（AFCD 官方名單 `CAMP_LIST`，唔准輸出座標）同【畫路 CP／起終點】（官方地名 `NONCAMP_LIST` 或網上真实座標，**嚴禁用營地做畫路 CP**，座標必須真实搵到、唔好虛構）。`BASE_RULES`（調整）＋`GEN_RULES`（生成）都跟呢套。
- **確認面板**：有 AI 網上查找點時轉 amber 警告，列出嗰啲點名，提醒「喺地圖睇清楚、確認先計」；過夜營地標明 AFCD 官方。表格 AI 點行 amber 底＋「⚠ AI 網上查找」。
- **結果 CP 清單**：加來源欄，AI 點 amber 底＋「⚠ AI 網上查找」；role 顯示「畫路 CP」。
- **refine／manualAdjust prompt**：畫路 CP 用山峰／山坳／路口／海邊點＋網上座標，唔再塞營地。

### 安全／誠實
- 過夜營地硬守 AFCD 官方（resolveNamePlan 強制），AI 唔可以俾個隨便座標當營地。
- 畫路 CP 係 AI 網上查找，標明來源＋amber 警告，要成員喺確認面板／地圖睇過先計；DTR 磁石貼返最近山徑，計完可拖曳微調。
- AI 座標限 HK 範圍，擋明顯 hallucination；prompt 双重聲明「唔好虛構座標」。
- 測試：`canvas_gazetteer.test.mjs` 改寫「營地官方／畫路 CP 網上座標」case，全套 40。

## Phase 3.7 — 官方準確座標做自由選項（三角網測站＋標距柱）

### 目標
畫路時除咗網上搵到嘅座標，AI／成員仲可以**自由揀用**兩套官方準確座標：
- **地政總署三角網測站**（231 個，山峰／高地控制點，WGS84）。
- **漁護署遠足徑標距柱**（940 個，沿徑每 500 米一支）——麥理浩徑 M001–M200、衛奕信徑 W001–W137、港島徑 H001–H100、鳳凰徑 L001–L139、各郊遊徑 C 字頭（如 C1101）。

**呢啲係「加進來嘅選項」，唔係優先**：AI 可以自由揀官方點、亦可以揀網上座標，冇任何偏好引導（成員明確要求「你優先就不自由了」）。過夜營地仍然硬守 AFCD 官方。

### 數據來源
- 三角網測站：地政總署數據（Esri China HK 轉發嘅 ArcGIS FeatureServer，EPSG:4326 Point geometry，231 個）。內置 `TRIG_DATA`（`[編號,英文名,lat,lon]`）＋38 個名山中文別名 `TRIG_ZH`。
- 標距柱：漁護署開放數據 `AFCD_Distance_Post.csv`（data.gov.hk）。內置 `DP_DATA`（`[編號,lat,lon,徑index]`）＋`DP_TRAILS`。排除咗越野單車徑（62 支），保留 940 支遠足徑標距柱。
- 數據只係內置 lookup，**唔會塞入 AI prompt**（避免 prompt 爆炸）；AI 用編號／名引用，系統先填官方座標。

### 機制
- **`findDistancePost(label)`**：regex 抽 `[MWHL]\d{3}|C\d{4}` 編號 → `DP_BY_CODE` → 官方座標，`source:'AFCD官方（標距柱）'`、`_official:true`。
- **`findTrigStation(label)`**：
  - 有「測站／三角網測站／stn」標記＋編號 → 按編號查（**避免海拔數字誤配**：例如「飛鵝山 605」嘅 605 係海拔，唔會誤配去編號 605 嘅測站）。
  - 英文名（精確 → 中文別名 `TRIG_ZH` → 最長包含）→ 官方座標。
  - 成個 label 係純編號（如「67.2」）→ 直接查。
  - `source:'地政總署官方（三角網測站）'`、`_official:true`。
- **`resolvePoint`（畫路點）**：精確官方名 → **標距柱 → 三角網測站** → AI 網上座標 → 模糊官方名。AI named 官方點就填官方座標（尊重 AI 揀選，唔係優先）。
- **`findPlace`（表單／checkFixed）**：末尾加精確標距柱／測站解析，咁成員手動填起訖點、refine 按名重解析都認得。
- **refine 韌性**：官方點 normalize 後嘅 label（如「M020（麥理浩徑）」、「TAI MO SHAN（三角網測站 67.2）」）仍含編號／名，refine 剝走座標後重新解析都攞返官方座標。

### 營地守衛（不變＋加強）
- `resolvePoint` overnight 仍必須 `kind==='campsite'`，否則拒「過夜必須係 AFCD 官方營地」。
- `buildPlanFromForm`／`runAiPlan` 嘅營地欄加 `kind!=='campsite'` 守衛——而家 `findPlace` 認得測站／標距柱，要防止佢哋被當營地過夜。

### Prompt（中性、冇優先）
- `PLACE_RULES` 加【官方準確座標・自由選用】段落：列兩套選項＋編號格式＋例子，明言「兩者皆可，冇話要優先邊種」「自由選擇，唔使刻意偏好任何一種」。
- `BASE_RULES`／`GEN_RULES` 畫路 CP 描述由「網上搵座標」改為「官方測站／標距柱或網上座標皆可」。

### UI
- 確認面板／結果 CP 清單：官方測站／標距柱行 green 底＋「✓ 地政總署官方（三角網測站）」／「✓ AFCD官方（標距柱）」；AI 網上點維持 amber＋「⚠」。
- 橫幅：全部官方時「✓ …來自官方（AFCD／地政總署）或已核實地點表」；有 AI 點時額外講明「三角網測站／標距柱亦係官方準確座標」。
- `places` datalist 加測站（中文別名做值）＋標距柱編號建議。

### 測試
- `canvas_gazetteer.test.mjs` 加兩個 Phase 3.7 case：數據數量（231／940）＋名山／M020 官方座標＋中性 wording（冇「優先使用三角網測站」）＋lookup 行為（海拔碰撞、營地守衛、refine 重解析、表單路徑）。全套 42（gate 9＋contract 11＋embed 12＋gazetteer 10）。

## Phase 3.8 — 貼路失敗＝可修理失敗（唔再放過直線備援）＋地理連貫守則

### 背景（用戶實測不合格）
Phase 3.7 後用戶自由規劃實測：AI 揀咗跨海／離網嘅畫路 CP（萬宜水庫西壩、蛋家灣、KO LAU WAN、灣仔半島觀景點），BRouter 貼唔到路 → 引擎直線＋SRTM 備援 → `all_legs_snapped=fail`、數字 criterion 變 `unknown`。舊 `maybeRefine` 見到 `fallbackUsed` 係**直接 stop＋warn、唔修理**，將不可用嘅直線預覽當成答案呈現。用戶：「呢d 功課不能接受」。

### 修復
- **`maybeRefine` 重寫**：
  - 由 `result.legs[].snapped` 計 `badLegs`／`snapFail`（＋`result.fallbackUsed`）。
  - **移除 fallback bail**：貼路失敗而家係「可修理失敗」，同距離／爬升超標一樣触发自動調整循環。
  - 修理指示：点名出事路段（from→to）；若端點係可移除畫路 CP → 替換做同一山徑網絡、唔跨海／跨水塘嘅沿徑點（標距柱／路口／山坳，可用編號）；若兩端皆固定點 → 喺之間插入 ≤2 個沿徑 CP 引導貼路。唔改起點／營地／終點。
  - **誠實報告**：唔會自動調整（auto off／stop／cap 0）而仍有 snapFail → `status.bad`「✗ 不合格…不可用、不可導航」；到上限仍 snapFail → 同樣標不合格＋列出仍出事路段。全貼路＋達標先至 `ok`。
- **`resultSummary`**：帶 fallback 警告（距離被低估、不可靠）＋出事路段名，咁 AI 調整時知道邊段出事。
- **`manualAdjust`**：加 `snapInstr`——手動「按其他要求調整」都一并修理離網點。
- **`renderResult`**：fallback 時頂部紅色橫幅「✗ 不合格…只係候選預覽」，結果面板本身明確標不可用。
- **`PLACE_RULES` 地理連貫守則**：畫路 CP 要同起終點／營地同一連接山徑網絡；唔好揀跨海／跨水塘點（對面島、水塘對岸、孤立海岬）；沿徑揀點最易貼路。呢個係**有效性**守則，唔係座標來源優先（AI 自由度不變）。

### 測試
- `canvas_gazetteer.test.mjs` +2 case（gazetteer 12）：substring 回歸（舊 bail 移除、不合格橫幅、連貫守則）＋functional harness 模擬 `maybeRefine` 決策（fallback→触发修理／auto-off→不合格／到上限→不合格／全貼路達標→ok／resultSummary 帶警告）。全套 44（gate 9＋contract 11＋embed 12＋gazetteer 12）。

### 已知／deferred
- 地圖 label 重疊（多個 permanent tooltip 近距離互相蓋住）係 DTR iframe 內 Leaflet 渲染問題（src/），屬次要 cosmetic；今次聚焦路由質量，未改 src 地圖渲染。

## Phase 3.9 — 確定性清理地圖（無穿海直線／無原路來回）＋回頭路偵測＋環線守則

### 背景（用戶實測仍不合格）
用戶直接用 git 最新 html（即 3.8）實測：地圖仍見穿海直線（大灘／猴塘溪 → KO LAU WAN 三角網測站 644），且「老是走回頭路、同一條路來回」。診斷：
- 3.8 修理到上限／被 guard 拒絕時**只喺文字標不合格，地圖仍畫住含 fallback 嘅 plan** → 穿海直線留低。
- bridge `LegResult` **冇路段幾何** → Canvas 偵測唔到回頭路；AI 揀掘頭 spur 點 → 路由器原路入出 → 同一條路行兩次。

### 修復
- **bridge 加 leg geometry**（`src/bridge/contract.ts` `LegResult.geometry?: [lat,lon][]`；`embedBridge.ts` `sampleGeom(seg.points)` 取樣 ≤240 點）。屬 bridge 範圍，src 路由引擎不變。
- **Canvas `autoClean`（確定性，唔靠 AI）**：route:result 後先跑——
  - fallback 路段：移除離網畫路 CP（role=cp）再計 → 保證地圖無穿海直線。
  - 相鄰兩段幾何高度重疊（mutualOverlap>0.6）＝掘頭 spur 原路來回 → 移除共享 spur CP 再計。
  - 上限 `MAX_CLEAN_DROPS=6`；兩端皆固定點（起點／營地／終點）唔移除（交俾 AI／手動）。
  - 清理中唔 snapshot，等乾淨結果先截圖。
- **`detectBacktrack`**：用 leg geometry 計任意兩段 mutual overlap；>0.6 ＝回頭路／原路來回。`maybeRefine` 加 `backFail` 觸發＋指示（改做環線、去程回程唔同山徑、移除掘頭 spur）；達標條件加 `!backFail`；到上限仍 backFail 標 warn。
- **幾何 helper**：`segDistM`（point-to-segment 米）、`nearPolyline`、`overlapFrac`、`mutualOverlap`（NEAR_M=25、OVERLAP_FRAC=0.6）。
- **`PLACE_RULES` 環線守則**：CP 按環線順序；去程回程行唔同山徑；唔好原路來回／掘頭 spur（死胡同海岬／觀景點），除非用戶明確要求來回。
- **cleanDrops reset**：runPlan／runAiPlan／applyAdjust／btnConfirm 重置，每條新計劃／每輪 AI 調整有新鮮清理預算。

### 測試
- `bridge_embed.test.mjs`：加 leg geometry 斷言（[lat,lon] 陣列、≥2 點）。
- `canvas_gazetteer.test.mjs` +2（gazetteer 14）：substring（autoClean／detectBacktrack／MAX_CLEAN_DROPS／handler wiring／環線守則）＋functional harness（spur／fallback 移除離網 CP、正常環線唔誤報、固定點唔移除、到上限停止）。全套 46（gate 9＋contract 11＋embed 12＋gazetteer 14）。

### 保證
- 最終地圖**確定性**無穿海直線（fallback 離網 CP 會被移除再計），唔再靠 AI 合作先至乾淨。
- 回頭路／原路來回會被偵測＋確定性移除 spur CP；剩餘（非相鄰重疊／固定點）交 AI 改環線或手動。

## Phase 3.10 — 拆鎖（只鎖用戶填咗）＋放寬（唔迫 AI 揀名單）＋移除北潭涌 priming

### 背景（用戶回饋）
- 「一改就彈『AI 改動咗你指定嘅起點／營地／終點，已停止自動調整』」：`runAiPlan` 先計 user-only `uf/uc`，但隨後 `skeletonFromPlan(plan)` **overwrite** `fixedLabels/fixedCamps` 做全計劃骨架（包括 AI 自己揀、用戶留空嘅起終點／營地）→ refine 時 AI 改佢自己揀嘅點被 `checkFixed` 誤判 → 停止。
- 「唔使列出太多／迫佢揀仲難搞；佢係 AI 識自己諗」：收回「列一大堆起點」方向，改为**拆鎖＋放寬**，信任 AI；幾何問題交 3.9 `autoClean` 確定性執。
- 「先天性 lock 死北潭涌」：prompt 偏置（`NONCAMP_LIST` 全西貢、北潭涌排首＋placeholder 例子＋冇反預設指示）。

### 修復
- **拆鎖**：移除 `runAiPlan` 嘅 `skeletonFromPlan` overwrite；`fixedLabels/fixedCamps` 只保留用戶實際填咗（`uf/uc`）。AI 揀（用戶留空）嘅起終點／營地可自由改，唔再誤停。`checkFixed` 語義不變（只 guard fixed），而家 fixed 只係用戶點。
- **放寬 prompt**：移除「起終點／CP 可以用官方地名（`NONCAMP_LIST`）」forcing；改「你係遠足路線專家，自己諗、自由揀全港任何真實地點，唔使跟名單、冇預設」。連貫／環線提示合併做一句輕量常識提示（明言「唔係硬清單；系統會自動清理，你放手諗」）。低地提示移除具體點列。保留硬安全：過夜營地 AFCD 官方、嚴禁營地做畫路 CP、唔虛構座標、≤24 點、只鎖用戶明確填咗。
- **移除 priming**：placeholder「例如：北潭涌」→「留空由 AI 揀（全港任何起點）」；prompt＋GEN_RULES 加「唔好預設北潭涌／西貢」。
- **修理指示跟住拆鎖**：snapFail 修理明言「唔好改用戶明確填咗嘅點；用戶留空由你揀嘅起終點／營地可以自由改」。

### 測試
- `canvas_gazetteer.test.mjs` +2（gazetteer 16）：拆鎖 regression（冇 skeleton overwrite、fixed=uf/uc、prompt 只鎖用戶點）＋放寬（冇官方名單 forcing、專家自由、唔使跟名單）＋移除 priming（placeholder 中性、唔好預設北潭涌）＋安全保留；functional `checkFixed` 語義（fixed=[] 時 AI 改起點通過；用戶填咗被改則報錯；用戶起點保留＋AI 加中途點通過）。全套 48（gate 9＋contract 11＋embed 12＋gazetteer 16）。

## Phase 3.11 — 版號可見＋導師 persona＋起終點可行性＋繞路靠 CP（淨刪＋最小新增）

### 背景（用戶回饋）
- 示例路線「MA ON SHAN 山頂（測站 661）出發→M001→…→西貢市」不可行：山頂冇交通（「塔直升機遊繩去出發嗎？」）、順序跳序。AI 淨係揀點，唔係以領隊思維策劃可行路線。
- 用戶連環纠正過度規範：**唔強制環線**（起終點可以不同，毅行者 100km 就係 point-to-point）；**跨區完全合理**（5 日唔跨區冇路可想）；「若起==終先環線」呢種條件式解釋係**完全冇用嘅 prompt**（起==終當然係環線，AI 自己識）——成句刪，唔留任何環線／point-to-point 解釋。
- 「html 頂同入到去都睇到版號」——一眼知有冇改到。
- 「DTR 喺 CP 之間行最直接；要佢行第二條就加 CP 引導」——繞路嘅正確機制。

### 修復（淨刪＋最小新增，唔再加枷鎖）
- **版號**：`<title>`＋header `<span class="ver">v3.11</span>`（每次更新 bump；測試斷言兩者一致）。
- **導師 persona**：GEN_RULES 開頭「你係資深遠足導師／領隊，策劃切實可行、合理嘅遠足路線」。
- **兩句最小新增**（PLACE_RULES，gen/refine 共用）：
  1. 起終點必須交通可達（徑口、碼頭、巴士／小巴站、村）；山頂／三角網測站只可以做中途 CP，唔好做起終點。
  2. 引擎喺相鄰點之間行最直接山徑；要行長啲／指定路徑，加中途 CP 引導繞路，唔好靠引擎自動繞遠。
- **刪**：「環線去程同回程行唔同山徑」成句＋「呢啲係常識提示…你放手諗」meta 噪音；refine 指示／狀態訊息嘅「改做環線」全部去環線化（「改行唔同山徑嘅路徑」）。
- **留**：唔好原路來回／掘頭 spur（有效性約束）；3.9 autoClean／detectBacktrack 照行；跨區／point-to-point／環線點樣排——全部唔寫，AI 自己諗。

### 測試
- 3.9 測試斷言更新：環線解釋句**已刪**（`!includes('去程同回程行唔同山徑')`），no-backtrack 保留。
- +1（gazetteer 17）：版號 title/badge 一致 v3.11、導師 persona、交通可達＋山頂唔做起終點、最直接山徑＋CP 引導繞路、環線句全删（prompt/instr/status）、spur 約束保留。全套 49（gate 9＋contract 11＋embed 12＋gazetteer 17）。

## Phase 3.12 — 跨海游水線根治：blacklist 被移除點＋安全移除唔设 cap

### 背景（用戶回饋＋截圖）
- 截圖：黃石／大灘一條直線跨大灘海峽去蛋家灣（塔門方向，冇山徑駁過去）→ BRouter 貼唔到路 → fallback 直線。「佢成日游水過去」。
- Root cause（read-only 诊断確認）：autoClean **有**移除蛋家灣（role=cp、腿 !snapped），但 **refine 完全冇 blacklist**——只笼统講「替換離網 CP」，冇話 AI「蛋家灣已被移除、嚴禁加返」。AI 念念不忘又加返 → autoClean 又移除 → 循環到 refine cap 用盡 → 最後條跨海直線留喺地圖。

### 修復
- **Blacklist（`cleanRemoved` Set）**：autoClean 每移除一個 CP 記低佢個名；跨 refine 回合保留（只喺 3 個新計劃入口 reset：form／runAiPlan／btnConfirm；**applyAdjust 每輪 refine 唔 reset**，否則 blacklist 失效）。auto-refine＋manual 兩個 prompt 都加：「以下畫路 CP 已被系统確定性移除（離網／跨海／掘頭），嚴禁再加返：…」。呢個係有效性回饋（系統證實離網），唔係列清單迫揀。
- **跨海安全移除唔设 cap**：autoClean 分開 `safety`（離網／跨海，!snapped 腿嘅 CP）同 spur 優化移除。cap 檢查改 `if(cleanDrops>=MAX_CLEAN_DROPS && safety.size===0) return false;`——離網／跨海 CP 永遠移除（保證地圖最終冇游水直線），cap 只擋 spur／回頭路優化。配合 blacklist 唔會被加返，唔會無限循環。
- **版號 v3.12**（title＋badge）。
- 保留：用戶明確固定點照鎖（用戶自指跨海起終點＝不可能請求，誠實標不合格，唔亂移除固定點）；3.9 spur／回頭路偵測照行。

### 測試
- 3.9 functional harness 補 `cleanRemoved` deps＋`getRemoved`；3.11 版號斷言改 3.12。
- +2（gazetteer 19）：blacklist substring（兩處 prompt、聲明、4 次 new Set＝1 聲明＋3 入口、applyAdjust 唔 reset、safety bypass cap、記名）；functional（autoClean 記低蛋家灣、到 cap 仍移除跨海 CP、spur-only 到 cap 停）。全套 51（gate 9＋contract 11＋embed 12＋gazetteer 19）。

## Phase 3.13 — 放寬 refine cap＋busy 防止狂按＋status 置頂＋DP 編號後備座標＋掘頭 spur 單向包含偵測

### 背景（用戶回饋，5 項之 4；CP 指定欄留 3.14）
1. 「AI 揀咗未收录地点：北潭郊遊徑 C5314 標距柱」——AI 用編號但系統 DP 名單未收錄，且 prompt 叫佢唔使輸出座標 → 冇後備 → 拒絕。
2. 「提示字句放太底，用戶留意不到會狂按，彈窗檔著用戶」——status 喺 main 底部；busy 時冇禁用按鈕。
3. 「0–5 次太小，5 次完成不了，要放寬」。
4. 「點解話無回頭路？明明榕樹澳、灣仔半島兩個回頭路」——detectBacktrack 用 mutualOverlap=min(雙向)，掘頭 spur 出段折返後繼續行好遠會稀釋 min → 漏偵測。

### 修復
- **DP 編號後備座標**：prompt 加「【編號後備座標】…用編號引用時請同時輸出 lat/lon＋source 做後備；系統優先用官方座標，若編號未收錄就用你嘅真實座標」。resolvePoint 已有 validAiCoord 後備，而家 AI 會附座標 → C5314 呢類未收錄編號唔再被拒。
- **busy 防止狂按**：`aiBusy`＋`refreshBusy()`——AI 生成／調整（callGemini try/finally）或計路（pendingId）進行中 → 禁用 btnPlan/btnDemo/btnNotesAdjust/btnConfirm/btnAddDay。startRoute／route:result／route:error 接線。
- **status 置頂 sticky**：`#status` 移去 header 之下＋`position:sticky;top:0;z-index:80`——用戶滾動都見到「規劃中／計路中／完成」，配合 busy 禁用防止狂按。
- **cap 放寬 0–12**：fRefineCap max 12、預設 6；MAX_REFINE_ROUNDS=6；refineCap clamp 12。
- **掘頭 spur 單向包含**：detectBacktrack 除 mutualOverlap 外，加「相邻腿共享 tip 且 overlapFrac(入段,出段)>0.6」→ 出段折返後繼續行好遠都捉到；autoClean spur  loop 同步加呢個條件 → 移除榕樹澳／灣仔半島呢類掘頭 tip CP。
- 版號 v3.13。

### 測試
- 舊 cap 測試更新（預設 6／0–12）；版號斷言 3.13。
- +2（gazetteer 21）：cap/busy/status 置頂/DP 後備 substring；functional 單向包含（mutualOverlap 稀釋 ≤0.6 但 overlapFrac(入,出)>0.6 → detectBacktrack 捉到、autoClean 移除 tip）。全套 53（gate 9＋contract 11＋embed 12＋gazetteer 21）。

### 留低 3.14
- 用戶指定畫路 CP 欄（導師指定 CP）：需座標或 HK 網格參考（「kk xxxxxxxx」格式待用戶確認），同營地（按名）唔同。待確認格式後做。

## Phase 3.14 — 用戶（導師）指定畫路 CP：MGRS／UTM＋decimal 座標欄＋鎖死

### 背景（用戶回饋）
- 「導師會指定 CP，用戶輸入指定 CP 令 AI 易啲查找；CP 同營地唔同，要用戶入座標或 kk xxxxxxxx（童軍 MGRS）先讀到」。
- 用戶確認：格式＝**MGRS／UTM 網格（童軍常用）＋十進制經緯度（Google Maps）**；用戶指定 CP＝**鎖死**（AI 必須保留、順序不變）。

### 修復
- **新欄 `fUserCps`**（textarea，每行一個）：`名 MGRS`（如 `榕樹澳 50Q KK 12345 67890`）或 `名 lat,lon`（如 `灣仔半島 22.4123, 114.3456`）。
- **MGRS→WGS84 轉換器**（純 JS，WGS84 UTM forward/inverse＋MGRS 100km 方格解碼，zone parity／2,000km cycle 用緯度帶解析）；decimal 直接收；全部過 `validAiCoord` HK-bounds 閘。`parseCpLine`／`parseUserCps` 解析，壞格式／離港報錯。
- **鎖死語義**：`userCps` global；`resolvePoint` 對用戶 CP 直接用用戶座標（`_userFixed`，AI 唔准改）；`checkFixed` 強制用戶 CP 全部保留＋按用戶順序（子序列）；`removableCp` 排除 `_userFixed`（autoClean 唔會移除鎖死 CP；若鎖死 CP 離網，誠實標不合格＋叫 AI 插引導點，唔亂移除）。
- **注入**：form 路（buildPlanFromForm）將用戶 CP 注入 waypoints（camps 之後、finish 之前）＋fixedLabels；AI 路（runAiPlan）spec 列明「用戶指定畫路 CP（鎖死：必須保留、按順序、用呢個座標）」連座標，resolvePoint 強制座標、checkFixed 強制保留。
- **showConfirm**：用戶 CP 顯示 ✓ 用戶座標／MGRS（綠），座標列明供成員核實。describeForm 附用戶 CP。
- 版號 v3.14。

### 測試
- 3.7／3.10 harness 補 `userCps`；版號斷言 3.14。
- +3（gazetteer 24）：CP 欄／鎖死 substring；MGRS functional（HK round-trip <1e-4、Honolulu 100km 方格＝4QFJ＋真實 round-trip、decimal／MGRS／壞格式／離港）；checkFixed 鎖 CP（保留＋順序通過、漏咗／調序報錯）。全套 56（gate 9＋contract 11＋embed 12＋gazetteer 24）。

## Phase 3.15 — 領隊策劃原則 prompt＋山頂起終點 code 把關＋refine 最小修改（AI 識策劃遠足營）

### 背景（用戶回饋）
- 「又出現番山頂開始」（MA ON SHAN 測站 661 做 start）——3.11 prompt 規則被 AI 忽略（因官方座標 section 主動提供測站，AI 貪準確座標揀做 start）。
- 「成日當自己唔係行山，成日行車路」（大學站→烏溪沙站、黃石→西貢市 沿馬路）。
- 「用曬 12 次都搵唔到好路線」——初始計劃爛＋refine 震盪。
- 用戶定調：「DTR 工具完美，問題係讓 AI 知道正常如何策劃遠足／遠足營路線，即係寫 prompt 嘅問題」。

### 修復
- **PLAN_PRINCIPLES（領隊策劃原則，原則唔係點名單）**置於 GEN_RULES 開頭：①骨架先行（起→每日營地→終，再補 CP）；②起終點交通可達、嚴禁山頂／測站做起終點；③全程山徑、禁車路段、CP 揀山徑網絡點；④每日負重合理、營地放当日段末；⑤營地 AFCD 官方；⑥第一輪就要出可行計劃。
- **山頂起終點 code 把關**：runAiPlan 生成後偵測 start/finish 係 trig（findTrigStation）且用戶留空（AI 揀）→ 自動追加修正指示重生成一次（有界 attempt<2，唔計 refine 回合）；仍山頂→誠實拒絕。用戶明確填咗就尊重。
- **refine 最小修改**：instr 開頭加「保持已貼路／達標骨架，只作最小必要修改，唔好成個計劃重砌」→ 減少震盪、避免用盡 12 回合。
- 版號 v3.15。

### 測試
- +1（gazetteer 25）：PLAN_PRINCIPLES／GEN 包含／山頂把關（badStart/badFin/有界重試/誠實拒絕）／refine 最小修改 substring。全套 57（gate 9＋contract 11＋embed 12＋gazetteer 25）。

## Phase 3.16 — AI 策劃報告（透明化）＋水浪窩官方優先＋anti-虛構測站＋分工原則

### 背景（用戶回饋）
- 用戶策劃哲學：「先將要求嘅點全部 point 出嚟→睇點連貫達標→加入用戶要求→最後交 DTR 精確計算／微調」。
- 「三角網測站 77 雞公山 未收錄？」——查證：231 官方測站全收錄；**no.77 不存**；真「雞公山 KAI KUNG SHAN」係 no.259（大嶼山），西貢雞公山 399 唔係測站。即 AI 虛構編號，把關啱。
- 「水浪窩 mark 錯」——gazetteer 已有「水浪窩營地」官方 (22.40274,114.275183)，但 findPlaceExact("水浪窩") 唔 match「水浪窩營地」→ 落 AI 座標（hallucinate）→ mark 錯。
- 「生成 6 次 0 達標，讓 AI 產出報告睇佢點策劃以便找問題」。

### 修復
- **findPlaceExact 官方優先**：加「去掉『營地』後精確匹配」→ 水浪窩／已知徑口營地直接用官方座標，AI 俾錯座標都覆蓋。functional 測試確認。
- **AI 策劃報告**：JSON 加 `report` 欄＋prompt 強制；新 `reportPanel`／`showReport`（escape＋pre-wrap）；gen（runAiPlan）＋refine/manual（applyAdjust）都顯示。透明化 AI 點諗，方便诊断。
- **PLAN_PRINCIPLES 7/8**：⑦分工（AI 策劃→DTR 精確計算，AI 數字只係預算）；⑧anti-虛構（唔好作測站編號，舉例 77 雞公山不存在；已知徑口優先用官方名）。
- 版號 v3.16。

### 網上類似工具研究（參考）
- **Komoot Premium multi-day planner**：先 plan 一條連續山徑路線，再自動拆每日 stage＋stage 末加住宿——同用戶「骨架先行→連貫→計算」哲學一致；sport-aware routing（surface/waytype/elevation）即我哋 hiking-mountain。
- **AllTrails Peak Route Assistant**：day-by-day split＋campsite/water/resupply/bailout waypoints；強調 curated trail data 而非 AI 估座標。
- **Outdooractive／Gaia／CalTopo**：professional topo＋terrain analysis；**FarOut**：trail-specific campsites/water/town。
- 啟示：業界都係「curated 山徑數據＋sport-aware 引擎＋每日 stage 拆分」，AI 只做策劃／研究唔做座標權威——印证我哋 Option A（DTR 引擎精確計算）＋官方座標優先＋報告透明化方向啱。

### 測試
- +2（gazetteer 27）：報告 panel/showReport/report format/anti-虛構/分工/findPlaceExact substring；水浪窩官方優先 functional（AI 錯座標→官方 22.40274,114.275183、唔標 _aiFound）。全套 59（gate 9＋contract 11＋embed 12＋gazetteer 27）。

## Phase 3.17 — DTR 繞路清單橋（route:options）：AI 只揀唔估，根治 12 回合震盪

### 背景（用戶轉述另一人方向，採納）
v3.15/16 死結＝「AI 估座標／距離 → DTR 否決 → 12 次用晒」。正確分工：**AI 諗方向／偏好（Canvas），DTR 淨係計數**。加一條橋：Canvas 問「骨架差 X km，附近有咩貼路點可以繞、每個加幾多？」DTR 計完俾清單；AI 喺清單度**揀**，唔使估。

### 實現
- **contract.ts**：`LIMITS.MAX_OPTION_CANDIDATES=12`；`DetourBaseLeg/DetourCandidate/DetourOption` 型別。
- **embedBridge.ts**：`route:options` handler——對每個候選 c，用 `planRoute([legFrom, c, legTo])`＋`analyzeRoute` 計真實 `addKm=(子路由距離-原leg距離)`、`addAscentM`、`snapped=legMeta.every(snapped)`；回 `route:options-result {options}`。沿用 handshake/busy/timeout/requestId 去重／精確 targetOrigin。
- **Canvas**：`buildCandidatePool`（DP/trig/gazetteer 非營地點，距骨架 leg ≤2km、唔喺計劃內，取最近 12）；`requestDetourOptions`（送 baseLegs＋candidates）；`onDetourOptions`（過濾 snapped&&addKm>0 → 用 `PICK_RULES` 叫 AI 只輸出 {"pick":[ids]}，按用戶偏好＋真實 addKm/addAscent 揀）；`insertDetours`（按 origLegIndex 插入 waypoints，骨架順序不變，重新計路）。
- **maybeRefine**：太短（!snapFail&&!backFail&&distKm<target）→ 行 DTR 清單流程；冇候選先 fall through 舊 AI 流程。
- 版號 v3.17。

### 效果
AI 唔再估座標／距離（唔會再「估西灣山→離網→估鹹田灣→跨海」）；DTR 保證清單個個貼路、個個知加幾多；AI 只按偏好揀 → 收斂快、唔浪費回合。

### 測試
- embed +2（14）：route:options 真實 addKm=1／snapped=true；fallback→snapped=false。
- gazetteer +2（29）：橋 substring（send/接/pool/PICK_RULES/太短攔截）；insertDetours functional（origLegIndex 插入位置＋重新計路）。全套 63（gate 9＋contract 11＋embed 14＋gazetteer 29）。
