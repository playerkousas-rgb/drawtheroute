# 65 — Phase 1：DrawTheRoute Embed Bridge（Option A）實施記錄

> **狀態：已喺 branch `arena/aec026b9-drawtheroute` 砌好，本地測試通過；未 deploy Production。**
> 方向：使用者裁決 **Option A — Canvas 內嵌真實 DrawTheRoute app**（保留完整地圖／互動／GPX 體驗）。
> 額度：使用者確認 AI 額度係成員自己 Gemini session、Vercel hosting 頂得順；BRouter／高程請求同 DTR 平時操作同一批，唔新增負擔。

---

## 1. 數據流

```
成員喺 Canvas 講遠足要求
   ↓ Gemini AI（fetch 攔截，免費）理解、拆解每日 CP
   ↓ Canvas parent postMessage(route:plan, 精確 SCF origin)
   ↓ DrawTheRoute iframe bridge：驗證 origin/source/schema/requestId
   ↓ useRouteManager.planRoute → buildSegment → BRouter hiking-mountain（真實計算）
   ↓ 同時 setWaypoints/setSegments → 地圖畫出完整路線（完整體驗）
   ↓ analyzeRoute（同 UI 同一份 Naismith／爬升核心）
   ↓ postMessage(route:result, 精確 origin)：距離／爬升／時間／warnings／criteria
   ↓ Canvas AI 整理新手友好答案；成員可喺 iframe 親手微調、匯出 GPX
```

## 2. 改動清單

| 檔案 | 類型 | 說明 |
|---|---|---|
| `src/services/routeAnalysis.ts` | 新增 | 由 `useTerrainAnalysis` 抽出嘅純函數（analyzeSegments／computeRouteStats／naismithMinutes／analyzeRoute），bridge 同 UI 共用 |
| `src/hooks/useTerrainAnalysis.ts` | 改 | 改為用 routeAnalysis 純函數（行為完全一致，只係共用核心） |
| `src/hooks/useRouteManager.ts` | 改 | 新增 `planRoute(points)`（headless 建整條路線，复用真實 buildSegment，set state 畫地圖）；暴露 `buildSegment`／`planRoute` |
| `src/bridge/contract.ts` | 新增 | Message contract v1：channel／version／limits／error codes／origin 驗證／plan runtime validator／結果型別 |
| `src/bridge/embedBridge.ts` | 新增 | `useEmbedBridge` hook：handshake、嚴格 origin/source 驗證、單一請求、逾時、取消、去重、組裝結果 |
| `src/App.tsx` | 改 | 接入 `useEmbedBridge({ planRoute, naismith, appVersion })` |
| `index.html` | 改 | Embed bootstrap：偵測 iframe＋embed=1＋合資格 parentOrigin → 設 `window.__DTR_EMBED__`；embed 用 gate `open`，非 embed 維持 `entry-gate` |
| `vercel.json` | 改 | 加 CSP `frame-ancestors 'self' https://*.scf.usercontent.goog`（只喺 deploy 生效） |
| `embed-test.html`（root，唔入 dist） | 新增 | 本地測試頁（模擬 Canvas parent）；已入 `.vercelignore`，唔上生產 |
| `.vercelignore` | 改 | 排除 `embed-test.html`（root，唔入 dist） |
| `scripts/bridge_contract.test.mjs` | 新增 | Contract validator 10 項測試 |
| `scripts/bridge_embed.test.mjs` | 新增 | Bridge hook 整合 7 項測試（jsdom＋RTL，模擬 parent） |
| `package.json` | 改 | `npm test` 加入兩個 bridge 測試 |

**冇改 `public/store_gate_v1.0.js`（共享閘門原封不動）；冇改白名單／Push／其他 repo。**

## 3. Message Contract v1（實際實施）

共通：`{ channel: "scout.drawtheroute", version: 1, type, requestId? }`

| 方向 | type | payload |
|---|---|---|
| DTR → parent | `drawtheroute:ready` | `{ bridgeVersion, appVersion, schemaVersion }` |
| parent → DTR | `canvas:init` | `{ protocolVersion, parentOrigin }` |
| DTR → parent | `canvas:init-ack` | `{ bridgeVersion, schemaVersion }` |
| parent → DTR | `route:plan` | `{ plan }`（見下） |
| DTR → parent | `route:result` | `{ result }` |
| DTR → parent | `route:error` | `{ code, message, retryable }` |
| parent → DTR | `route:cancel` | `{}` |

`plan`：`{ days?, nights?, targetTotalKm?, start:{label?,lat,lon}, waypoints:[{id?,label?,lat,lon,role?}], stages?:[{day,from,to}], constraints?:{maxMovingMinutesPerDay?,maxAscentMPerDay?,targetDistanceToleranceKm?} }`
- 冇 `stages` 就用 `role:'overnight'` 推斷日界。
- 座標必須真實 WGS84（lat -90..90、lon -180..180）；CP 上限 24 點、日數上限 14。

`result`：`{ source:"drawtheroute", engineVersion, bridgeVersion, computedAt, total:{distanceM,ascentM,descentM,estimatedMovingMinutes}, days:[…], legs:[{index,day,from,to,distanceM,ascentM,descentM,estimatedMovingMinutes,snapped,mode}], warnings:[…], criteria:[{id,label,status:pass|fail|unknown,detail}], fallbackUsed, humanReviewRequired:true }`

Error codes：`BAD_ORIGIN／BAD_SOURCE／BAD_MESSAGE／UNSUPPORTED_VERSION／NOT_READY／INVALID_PLAN／BUSY／DUPLICATE／TIMEOUT／CANCELLED／ENGINE_ERROR`。

## 4. Security 模型（四層）

1. **CSP frame-ancestors**（`vercel.json`，deploy 生效）：`'self' https://*.scf.usercontent.goog` — 只有 Google SCF（Canvas）或 same-origin 嵌到 DTR。**唔係 `'*'`。**
2. **Embed bootstrap**（`index.html`）：`?embed=1` 只係模式選擇；必須 `inIframe` ＋ parentOrigin 係 SCF／same-origin／dev localhost 先設 `__DTR_EMBED__`。頂層非 embed 維持 `entry-gate`，唔會因任意 query 繞過。
3. **Bridge origin/source 驗證**：`event.origin === parentOrigin` 且 `event.source === window.parent`；targetOrigin 一律精確 parentOrigin（**嚴禁 `'*'`**）。handshake（canvas:init）完成前先至接受 route:plan。
4. **資源限制**：單一同時請求、180s 逾時、requestId 去重、取消、CP／日數上限、schema 驗證。

> postMessage 唔係安全邊界（計劃 §6.4）；真正防 unauthorized embedding 靠第 1 層 frame-ancestors。DTR 冇敏感資料，BRouter／高程係公開服務。

## 5. 新手安全把關（已內建）

- `humanReviewRequired: true` 永遠。
- fallback leg → `snapped:false`、`FALLBACK_STRAIGHT` warning、`all_legs_snapped` criterion = `fail`、所有數字 criterion = `unknown`（**fallback 不可 pass**）。
- criteria 只比對使用者明確訂嘅門檻；冇門檻／冇容差 → `unknown`（待領隊確認），唔自創標準。
- 結果标明 `source:"drawtheroute"`＋engine／bridge version＋computedAt。

## 6. 點測

### 本地／Arena preview
1. Dev server 已行（port 5173）。
2. 喺 live preview 開 **`/embed-test.html`**（模擬 Canvas parent）。
3. 佢會自動握手 → 撳「送出 route:plan」（預設北潭涌→上窰→北潭涌短環線，真實 WGS84）。
4. 應該見到：DTR iframe 畫出路線＋右邊真實距離／爬升／時間／criteria／warnings。
5. 可改 textarea 個 plan JSON 試其他座標／門檻／fallback。

### 自動化測試
```
npm test        # crosssection + gate(9) + bridge_contract(10) + bridge_embed(7)
npm run build   # tsc + vite，冇 type 錯誤
```
全部通過。bridge_embed 用 `--test-force-exit`（避免 180s timeout timer 令 node 唔退出）。

## 7. 已驗 vs 未驗

**已驗（sandbox）：**
- Contract validator 10 項、bridge hook 整合 7 項（握手／真實 analyzeRoute 結果／NOT_READY／INVALID_PLAN／DUPLICATE／錯誤 origin 拒絕／fallback 把關）。
- 現有 gate 9 項＋crosssection 冇回归。
- tsc＋vite build 成功。
- Dev server serve embed-test.html／embed root（HTTP 200），embed bootstrap 生效。

**未驗（要真實環境）：**
- 真實瀏覽器入面 real BRouter 端到端（sandbox 冇 browser；但 buildSegment 係 app 現有同一條 code path）。
- 真實 Gemini Canvas 入面 SCF origin 嵌入（要 Phase 3 Canvas HTML＋deploy 後）。
- 線上 frame-ancestors header 實際 response（deploy 後驗）。

## 8. Deploy 步驟（**要用戶明確同意先做**）

> **Production URL（2026-11-27 核實）**：`https://drawtheroute-yd8p.vercel.app/`（GitHub repo homepage 欄位）。
> 之前誤估 `drawtheroute.vercel.app` → Vercel `DEPLOYMENT_NOT_FOUND` 404（**唔係白名單／gate 問題**——請求根本未到 app）。probe v1.1.1／embed-test 已修正。
> ⚠ 生產版**而家仲未有 bridge**——Canvas 測試要用 Arena preview URL（`https://5173-icxm5y9f21nhsc9i6t6c0.e2b.app/`，臨時）或者 deploy 之後先用 production。
> Vercel connector token 對 `list_projects`／`get_deployment` 都 Access denied——deploy 要靠 git push（Vercel git integration）或者用戶修 token 權限。

1. 用戶覆核 diff＋本地試玩 `/embed-test.html`。
2. 用戶點頭 → commit＋push branch → deploy Production（Vercel）。
3. Deploy 後驗：線上 `Content-Security-Policy: frame-ancestors …` response header；頂層 entry-gate／GPX／地圖冇回归。
4. 然後先至寫 **Phase 3 Canvas HTML**（getRoute tool → 等 ready → canvas:init → route:plan → await result → 交返 Gemini）。

## 9. 可逆退場

- 全部改動 additive：移除 `useEmbedBridge` 呼叫＋index.html embed bootstrap＋vercel.json frame-ancestors 即回復原狀。
- `routeAnalysis` 抽出係 pure refactor，UI 行為不變；`planRoute` 只係新增，唔影響現有 addWaypoint／GPX。
- gate 腳本冇改；白名單冇改。

## 10. 未做（刻意）

- **Phase 3 Canvas HTML**：未寫（要 deploy＋真實 Canvas origin 確認後）。
- **正式路線 waypoint**：猴塘溪／大灘／北潭涌精確座標、40km 容差、每日門檻仍待用戶核實（計劃 Phase 2）。而家只係驗 bridge mechanics，唔係正式路線安全驗證。
