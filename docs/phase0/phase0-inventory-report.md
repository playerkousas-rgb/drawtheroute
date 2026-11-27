# 65 — Phase 0 技術盤點報告（DrawTheRoute × GEMINI Canvas iframe／postMessage）

> **狀態：Phase 0 — probe 已實測，收到決定性發現；等使用者裁決方向。** 本輪只新增／更新 `docs/phase0/`，**冇改任何 app code、冇 deploy、冇郁白名單／Push／其他 repo**。
> 分支：`arena/aec026b9-drawtheroute`（base `bab857d`）。
> 對應計劃：使用者提供嘅 `#65` 整合計劃。

---

## ⚠ 決定性發現（2026-11-27 probe 實測後更新）

**Canvas artifact origin 係 Google SafeContentFrame（SCF），係 per-content-hash 唯一 origin，唔係穩定可精確 allowlist 嘅 origin。**

實測 origin：
`https://69ftaztgixa94dsheiwr20fv59vn9n21atuck72tuujoefgxcr-h1029127910.scf.usercontent.goog`
（href 係 `blob:https://…scf.usercontent.goog/…`）

對照 Google 官方 SafeContentFrame 技術 blog（bughunters.google.com，2025-09-18）：
- origin 格式 `https://<hash>-h<version>.scf.usercontent.goog`，其中 `<hash>` = cryptographic hash of **`<product>` + `<parent_origin>` + `salt`**。
- `salt` 來源取決於 caching mode：
  - **Caching Disabled（預設）**：每次 render 用 **random salt** → **每次 origin 都唔同**。
  - **Caching Enabled（預設 salt）**：`salt = sha256(file_contents + parent.location.pathname)` → 同一內容＋同一路徑先共享 origin。
  - **Caching Enabled（custom salt）**：跟 product 提供嘅 `customFileIdentifier`。
- `*.usercontent.goog` 喺 **Public Suffix List**，每個 `<hash>-h<version>.scf.usercontent.goog` 係獨立 eTLD+1 → storage／process 各自隔離。
- SCF 已被 **Gemini Canvas**、AI Studio 等 50+ Google 產品採用，用嚟 render **untrusted** 用戶內容。

### 含義（對計劃 §8）
- origin **非 null**（所以 v1.0 probe 誤判「穩定」——**已修正**，非 null ≠ 穩定）。
- 但 origin 係 per-content／per-render 唯一：改內容、開新對話、不同用戶、甚至每次 render（若 caching disabled）都會變。
- → **「精確 origin allowlist」喺生產多用戶場景不可行**，撞計劃 §8 No-Go 條件：「Canvas 不提供穩定可 allowlist 的 Origin」。
- → 按計劃 §8 指示：**停低、向使用者解釋、比較 server-side API／中介工具方案；唔自行降級成「AI 猜條路」。**

### 仍然正面嘅實測結果
- `localStorage`／`sessionStorage` 可用 → artifact **唔係 opaque sandbox**（有真實 origin）。
- 父子 postMessage **雙向正常**；父見到子嘅 `event.origin` 係真實 SCF origin（唔係 null）。
- **外站 iframe 載到**：example.com 對照組有 `load` 事件（~322ms）→ Canvas **冇普遍禁止外站 iframe**。⚠ **2026-11-27 更正**：DTR 嗰個「load ~332ms」其實係載咗 **Vercel 404 頁**（當時誤用咗唔存在嘅 `drawtheroute.vercel.app`；真實 URL 係 `drawtheroute-yd8p.vercel.app`，核實自 GitHub repo homepage）——「DTR iframe 載到／frame policy 冇擋」呢個結論**作廢**，要用 probe v1.1.1 重跑＋目視確認。
- OSM 瓦片（img subresource）載到。
- `window.fetch` 確認被 Canvas PATCHED（符合 IG 生成器所述攔截機制）。
- DrawTheRoute 首頁 **cross-origin fetch 被 CORS 擋**（`TypeError: Failed to fetch`）→ 對 iframe 方案冇影響（iframe 載入唔受 CORS 管），但對 Option B（共享 module）要加 CORS header。

### 未齊嘅數據
- **目視確認**：使用者未回報 DTR iframe 見到咩（地圖／gate 攔截卡／空白）。按 entry-gate＋SCF origin 未 whitelisted 推斷，**大概率係 gate 攔截卡**（即 iframe 載到但 gate fail-closed）。
- **origin 穩定性實測**：要重新整理／開新對話再跑 probe 比較 origin（v1.1 已加比較功能）。
- **BRouter CORS**：未測（v1.1 有手動掣）。
- **外部 script 載入**：v1.1 新增自動測試（Option B 可行性）。

---

## 0. 一句話現況

Canvas＝**Google Gemini Canvas**，artifact 靠 fetch 攔截免費用用戶 Gemini 額度；function calling 可行；外站 iframe 載到、postMessage 正常。
**但 artifact origin 係 SCF per-content-hash 唯一 origin → 精確 allowlist 不可行（§8 No-Go）。** 而家要使用者喺「放寬到 SCF-scoped wildcard／共享 module／server-side API」之間裁決方向（見 §5）。

---

## 1. 已確認事實（repo 實查，唔係靠 plan 轉述）

### 1.1 Route engine 入口
- `src/hooks/useRouteManager.ts`（786 行）。核心係內部 `buildSegment(from, to, mode, vias, onProgress)`：
  - hiking mode → `useBRouter`；失敗嘅 leg → **直線內插＋SRTM 高程備援**。
  - 回傳 `{ segment, snappedLegs, totalLegs }`；`segment.mode` = `'auto'`（全部 leg 貼到山徑）或 `'straight'`（有 fallback）。
  - **即係 fallback 偵測現成有**，bridge warnings 可以由真實計算狀態帶出，唔使靠估。
- `buildSegment` 而家係 hook 內部 function，對外只暴露 `addWaypoint`／`importGPX`／`moveWaypoint` 等 UI 導向操作。
  → **Phase 1 bridge adapter 要將 `buildSegment`／`buildPoints`／`calcStats` 抽成可獨立呼叫嘅 headless 路徑**，唔使模擬 UI click。技術上可行。
- `src/App.tsx`：`useRouteManager()` 喺 line 60，`useItineraryData(waypoints, segments, selectedDate)` 喺 line 80（Naismith 時間估算／路程表）。

### 1.2 路由／高程服務
- `src/hooks/useBRouter.ts`：`https://brouter.de/brouter`，`profile=hiking-mountain`，`AbortSignal.timeout(15000)`，失敗回 `null`。
  多點請求上限 `MULTI_MAX_ANCHORS=9`、逐段重試 `RETRY_MAX_LEGS=16`、並發 `RETRY_CONCURRENCY=4`。
- `src/hooks/useElevation.ts`：`https://api.opentopodata.org/v1/srtm30m`，每批 100 點，失敗補 0。
- 地圖瓦片：OSM／OpenTopoMap／Esri World Imagery／HM20C（`mapapi.geodata.gov.hk`）；Leaflet marker 圖示由 `unpkg.com` 載入。

### 1.3 冇現成 bridge／API／PWA
- 冇 route `postMessage` bridge、冇 `/api/route` endpoint、冇 `/api` dir。
- `index.html` 入面嘅 `postMessage` 全部係 **Arena 平台注入**嘅錄影／element-picker script（`arena:init`／`arena:flush`／`inspect:mode`／`element:selected`），同路由無關。新 bridge 會完全分開、嚴格 origin。
- 冇真正 PWA service worker 註冊（gate 只係 `navigator.serviceWorker` install hint 檢查）。

### 1.4 儲存
- `src/` 入面**未見 localStorage 使用**（路線 state 喺 React）。
- 主要儲存風險係 **gate 嘅 sessionStorage 通行證**：跨站 iframe 會被分區／sandbox 封鎖。

### 1.5 Gate（`public/store_gate_v1.0.js`）
- 現時設定：`mode:'entry-gate'`、`portalIds:['appstore']`、`silentPortalIds:['library']`、`allowStandalone:true`。
- `entry-gate` 係**頂層** Referer＋sessionStorage 通行證設計；喺未核准 origin 嘅 iframe 入面會 **fail-closed 出攔截卡，成個 app 被隱藏**（`body > :not(#scoutStoreGate){display:none}`）。
- gate 本身已有 `iframe-only` mode 概念（配合 `vercel.iframe-whitelist.json` 嘅 CSP `frame-ancestors`），但**本 repo 冇呢個檔案**。
  → embed bootstrap 應該沿呢個既有機制設計，唔係 `?embed=1` 硬放行。
- **重要澄清**：gate registry 嘅 `gemini` portal＝用戶自己嘅 GEMINI Vercel app（`gemini-woad-sigma.vercel.app`，private repo），**唔係 Google Gemini Canvas**。`CANVAS_PORTAL_IDS` 已 deprecated 清空；舊版曾誤把 Google Canvas 當「管唔到閘嘅派發線」。

### 1.6 Frame headers
- `vercel.json` 而家**冇** `frame-ancestors`／`X-Frame-Options`（只有 `/assets/*` cache header）。
- Repo 層面冇擋，但**線上實際 response headers 未驗證**（見 §3 限制）。

---

## 2. 已確認事實（IG 貼文生成器 v1.8.0 例子分析）

使用者提供 `IG貼文生成器_v1.8.0.html`（865 KB，純前端）作 Canvas artifact 範例。關鍵發現：

1. **Canvas＝Google Gemini Canvas**。artifact 係純前端 HTML，「唔經任何後端」。
2. **免費 AI 機制＝fetch 層攔截**（例子 line 1016–1018 註解）：
   > Gemini Canvas 嘅「自動注入」唔係填 apiKey，而係喺 fetch 層攔截 `generativelanguage.googleapis.com` 嘅請求，改送去 `gemini.google.com` 內部端點。所以 apiKey 永遠係 `""`。
   - 即係用**用戶自己嘅 Gemini session／額度**，唔使 API key → 符合「no secrets in frontend」紅線。
   - **唔可以喺 fetch 之前 throw**（例如攔 empty key），否則攔截機制失效、必定失敗。
3. **Function calling 已實測可行**（使用者本輪確認「透過 API 取用工具」）。即係 `tools`／`functionDeclarations` → `functionCall` → 本地 executor → `functionResponse` 呢條 loop 經 Canvas 攔截路徑行到。
4. artifact 環境限制（例子註解）：
   - `prompt()` 被封鎖（line 3436）→ sandbox 冇 `allow-modals`。
   - `localStorage` 用 try/catch 包住（line 978–997）→ 可能被封（sandbox 冇 `allow-same-origin` 嘅跡象）。
   - 外部 **CORS fetch 可行**（例子直接 fetch `api.github.com` 讀 README）。
5. 例子 fully self-contained（inline base64 圖，冇外部 CDN script）→ 外部 subresource／script 載入能力**未從例子證實**，要 probe 測。

### 2.1 架構含義
- `getRoute` tool executor＝**artifact 內嘅 async bridge client**；function calling loop 留喺 artifact 本地。
- 唔使 API key、唔使後端 → 第一版維持純前端。
- **關鍵未知**：artifact iframe 嘅 `location.origin`、sandbox flags、能否嵌外站 iframe、postMessage 方向／origin。
- **風險路徑**：若 artifact 係 opaque sandbox（origin `null`）→ 嵌套 DrawTheRoute iframe **繼承 sandbox flags** → DTR origin 都變 `null`、storage 失效、gate fail-closed → **精確 origin allowlist 做唔到** → 撞計劃 §8 No-Go。
- **可行路徑**：若 artifact origin 穩定（例如某個 `googleusercontent.com` 或 `gemini.google.com` origin）→ 可以加入 DTR `frame-ancestors`／bridge allowlist；仲要驗 DTR 線上 frame headers＋gate embed 路徑。

---

## 3. 本輪限制（要使用者幫手／修正）

| 項目 | 狀況 | 需要 |
|---|---|---|
| Vercel connector | `validate_credential` ✅、`list_teams` ✅（無 team，personal account）；但 `list_projects`／`get_deployment` **Access denied**（token 權限不足，2026-11-27 再試仍然） | 使用者喺 Vercel 檢查 token scope，或直接提供 Production URL／deployment 資料 |
| 線上 frame headers | sandbox egress 只容 `github.com`／`npmjs`／`pypi`；`curl`／`fetch_page` 去唔到 `drawtheroute-yd8p.vercel.app`（SSL 被擋） | 使用者用瀏覽器 DevTools → Network → document response headers 截圖／貼返；或修 Vercel token 後再查 |
| 真實 Canvas origin／sandbox | sandbox 去唔到 Gemini Canvas | 使用者跑 `canvas-env-probe.html`（見 §4） |
| Production URL 確認 | ✅ **已核實（2026-11-27）**：`https://drawtheroute-yd8p.vercel.app/`（GitHub repo homepage 欄位）。之前估嘅 `drawtheroute.vercel.app` **唔存在**（Vercel `DEPLOYMENT_NOT_FOUND`）——probe v1.0/v1.1 同 embed-test 舊版用錯咗，已修正（probe v1.1.1） | — |

---

## 4. 診斷 probe：`docs/phase0/canvas-env-probe.html`

### 4.1 安全聲明
- **唔呼叫 Gemini API**（唔用任何 AI 額度）。
- **唔計算任何行程／路線**。
- **唔上傳任何資料**；報告只留喺本頁，由使用者複製返俾 AGENT。
- 唯一對外請求：DrawTheRoute／example.com iframe、一張 OSM 瓦片、DrawTheRoute 首頁 GET（測 CORS）。
- **BRouter CORS 連通測試預設唔跑**，要手動撳掣；結果明確標記「唔係行程計算結果」。
- 內部 srcdoc postMessage 測試：若 origin 係 opaque/null，診斷上迫住用 `'*'`（探測能力用，**生產 bridge 嚴禁 `'*'`**）；報告會標記。

### 4.2 點用
1. 喺 Gemini Canvas 開一個新 code canvas。
2. 切換去 code／編輯視圖，全選貼入 `canvas-env-probe.html` 內容。
3. 行 preview，等佢自動跑完（約 15 秒）。
4. 撳「📋 複製完整報告」，貼返俾 DrawTheRoute AGENT。
5. （選填）撳「測試 BRouter CORS 連通」掣，再複製多次報告。
6. **目視**上方 DrawTheRoute iframe：見到地圖＝載到；見到攔截卡＝gate 擋咗；空白／錯誤＝frame policy 擋咗。請一併回報見到咩。

### 4.3 量度清單
- **環境身份**：`location.origin`／`href`／`referrer`、`window.self===top`、`top.location` 可讀性、`localStorage`／`sessionStorage` 讀寫、`window.fetch`／`XHR.open` 係 native 定 PATCHED、`crypto.randomUUID`、UA。
- **srcdoc 子 iframe × postMessage**：子 origin、父見到子嘅 `event.origin`、子→父／父→子雙向、用咗咩 targetOrigin。
- **外站 iframe**：DrawTheRoute（目視＋load 事件＋resource timing＋postMessage ping）；example.com 對照組。
- **連線／CORS**：DrawTheRoute 首頁 GET、OSM 瓦片、（選填）BRouter。
- **初步判讀**：自動給 Go/No-Go hints（AGENT 會再覆核）。

### 4.4 Go／No-Go 決策樹（probe 實測後更新）
```
實測：origin = *.scf.usercontent.goog（SCF per-content-hash，非 null 但唔穩定）
      外站 iframe 載到、postMessage 雙向正常、storage 可用
        │
        ├─ 精確 origin allowlist？ → 不可行（origin 每次 render／內容／對話可變）
        │     └─ 計劃 §8 No-Go（對「精確 allowlist」而言）
        │
        └─ 要繼續，必須喺以下方向裁決（§5，全部需使用者明確同意）：
              A. iframe + SCF-scoped wildcard（*.scf.usercontent.goog）+ per-session origin binding
              B. 共享 engine module（Canvas import DTR 同一份 code，唔使 iframe）
              C. server-side route API（Canvas fetch DTR 後端）
              D. pinned-origin PoC（固定 artifact origin 做一次性驗證，非生產）
```

---

## 5. 方向選項（SCF 發現後；**全部未決定，需使用者裁決**）

精確 allowlist 已證不可行。以下係可行方向，各有取捨，**唔會 unilateral 揀**：

### Option A — iframe + SCF-scoped wildcard + per-session origin binding
- DTR `frame-ancestors https://*.scf.usercontent.goog`（**唔係 `'*'`**，只限 Google SCF domain）。
- DTR 由 iframe URL 讀 `?parentOrigin=<SCF origin>`，之後所有 `event.origin` 必須等於該 declared origin＋`event.source===window.parent`；回覆用 `targetOrigin=parentOrigin`。
- gate 加 embed bootstrap：只在 iframe＋SCF origin＋握手完成後開放限定規劃功能。
- **優點**：保留「Canvas 內嵌真實 DTR app」原意；reuse 現有 engine；唔使後端。
- **缺點／風險**：
  - 信任邊界放寬到**所有 SCF-rendered 內容**（50+ Google 產品、任何用戶嘅 artifact 都嵌到 DTR）。呢個係對「精確 allowlist」嘅明確放寬，**必須使用者同意**。
  - 任何恶意 SCF artifact 可嵌 DTR 濫用 BRouter／高程額度 → 要 rate-limit＋schema 驗證＋DoS 限制。
  - entry-gate 哲學（只經 APP STORE 等入口）要為 Canvas 開例外 → 需使用者同意。
  - declared origin 唔係身份密鑰；真正防 unauthorized embedding 靠 `frame-ancestors`（已 scoped）。

### Option B — 共享 engine module（純前端，唔使 iframe）
- 將 DTR routing core（`buildSegment`／`buildPoints`／`calcStats`／BRouter／elevation）抽成**共享 ES module**，DTR 以 static file＋**CORS header** serve；Canvas artifact `import` **同一份 code**（唔係複製邏輯，符合「不複製計算邏輯」）。
- Canvas 直接 call BRouter／opentopodata（要驗 CORS；probe v1.1 有 BRouter 連通掣）。
- **優點**：唔使 iframe、唔使後端、唔受 SCF origin 問題影響；reuse 同一份計算；維持純前端「免費」 philosophy。
- **缺點**：DTR 要 refactor 抽 engine＋加 CORS＋版本同步；Canvas 要自己畫地圖／摘要（冇內嵌 DTR app）；要驗 Canvas `script-src` 容許外部 script（probe v1.1 自動測；公開資料顯示 Canvas widget 用 D3/Three.js 等 CDN，大概率容許）。
- **偏離**：唔再係「內嵌 DTR」，而係「Canvas 用 DTR 嘅 engine」。

### Option C — server-side route API（計劃指定嘅 fallback）
- DTR repo 加 `/api/route`（Vercel serverless），Canvas fetch 佢（Canvas fetch 對非 Gemini endpoint 會 pass through，IG 例子 fetch api.github.com 成功）。
- engine core 抽成 pure module，client／server 共用；server 代 call BRouter／高程。
- **優點**：完全唔受 SCF origin／iframe 限制；可加 auth／rate-limit／額度保護；乾淨 separation。
- **缺點**：要起＋deploy 後端；要保護 BRouter／高程額度；偏離「先做同頁 iframe PoC」原意；要管 secret（如有）。

### Option D — pinned-origin PoC（一次性驗證，非生產）
- 若實測某固定 artifact origin 穩定（caching enabled），可以 allowlist **嗰個精確 origin** 做一次性 PoC，驗證 bridge mechanics＋engine 整合。
- **優點**：最快驗證「真 DTR engine 經 postMessage 回真實結果」呢條核心假設。
- **缺點**：唔 generalize 到生產（不同用戶／對話／內容 → 不同 origin）；只係 throwaway PoC。
- **用途**：無論最終揀 A/B/C，都可以先用 D 驗證 engine adapter 係咪 work。

### 比較速覽
| | A. iframe+wildcard | B. 共享 module | C. server API | D. pinned PoC |
|---|---|---|---|---|
| 保留內嵌 DTR app | ✅ | ❌ | ❌ | ✅ |
| 精確 allowlist | ❌（放寬到 SCF） | N/A | N/A | ✅（一次性） |
| 使唔使後端 | 唔使 | 唔使 | 要 | 唔使 |
| 生產可擴展 | ⚠ 需同意放寬 | ✅ | ✅ | ❌ |
| 改 DTR code 量 | 中（gate+bridge+headers） | 大（抽 engine+CORS） | 大（抽 engine+API） | 中 |
| 安全信任邊界 | SCF 全部內容 | Canvas 自身 | 後端控制 | 單一 origin |

**AGENT 傾向**：若要生產可扩展＋唔想放寬信任邊界 → **B 或 C**；若想最快保留「內嵌 DTR」原意＋使用者接受 SCF-scoped 放寬 → **A**。無論揀邊個，都可以先用 **D** 驗證 engine adapter。**呢個係建議，唔係決定；等使用者裁決。**

---

## 6. 紅線（重申，全程遵守）

- 精確 origin allowlist；**生產 bridge 禁 `targetOrigin:'*'`**。
- `?embed=1` ≠ 授權；gate 唔可以因 query 無條件放行。
- fallback leg **永不 `pass:true`**；要明確標記「未完成山徑路由，不可作導航」。
- criteria 只比對使用者明確訂嘅門檻；冇就回 `unknown`／「待領隊確認」，**唔自創標準**。
- `humanReviewRequired:true`；「安全／已批准」只依人手核實清單。
- 唔放任何 secret 喺 HTML／payload／bundle／Git。
- **未經使用者同意唔 deploy Production**；唔郁 Push／白名單／其他 repo。
- 40 km／營地順序／座標未核實前，**只驗 bridge，唔驗正式路線安全性**。

---

## 7. 下一步（probe 實測後）

1. **使用者**：回報 **目視** DTR iframe 見到咩（地圖／gate 攔截卡／空白）——確認 frame policy 冇擋、只係 gate fail-closed。
2. **使用者**：用 **probe v1.1** 重新整理 Canvas preview／開新對話再跑一次，用「origin 穩定性比較」輸入上次 origin → 確認 SCF origin 係咪每次變。（順帶跑 BRouter 連通掣＋睇外部 script 測試結果。）
3. **使用者**：喺 **Option A／B／C／D**（§5）裁決方向。呢個係架構＋安全信任邊界決定，必須使用者明確同意。
4. **AGENT**：收到方向後出 Phase 1 改動範圍（engine adapter／message schema／gate embed／headers／CORS／API，視乎選項）＋測試方法＋可逆退場方式。
5. 未確認前**不部署 Production**、**不寫 Phase 3 Canvas 測試頁**、**不 unilateral 放寬 allowlist／gate**。

---

## 8. 本輪改動清單

| 檔案 | 類型 | 說明 |
|---|---|---|
| `docs/phase0/canvas-env-probe.html` | 新增 | Canvas 環境診斷 probe（純診斷，唔係生產 code） |
| `docs/phase0/phase0-inventory-report.md` | 新增 | 本報告 |

**冇改任何 `src/`／`index.html`／`public/`／`vercel.json`；冇 deploy；冇 commit／push 以外嘅 git 操作。**
