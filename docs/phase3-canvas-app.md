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
