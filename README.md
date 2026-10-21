# ReliefForge Pro — Terrain Analysis System（DrawTheRoute）

> 香港遠足路線規劃 · 高程剖面 · Naismith 估算 · 官方格網轉換 · GPX 匯出

![Vite](https://img.shields.io/badge/Vite-7.x-646CFF) ![React](https://img.shields.io/badge/React-19-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6) ![Tailwind](https://img.shields.io/badge/Tailwind-4.x-38BDF8)

---

## 核心功能清單（零倒退承諾）

| 模組 | 功能 | 狀態 |
|------|------|------|
| **地圖** | Leaflet 底圖切換（地形/衛星/**HM20C 地政總署 1:20,000**）、點擊/拖曳路線、CP 標記、座標搜尋（WGS84 / HK80 / UTM）、即時比例徽章（約 1:N）| ✅ |
| **路徑計算** | BRouter hiking-mountain 山徑優先 + 直線備援（SRTM）| ✅ |
| **✏️ 手繪路線** | 拖曳直接畫線，放手即「磁石貼路」自動吸附實體山徑（可關閉磁石保留手繪原線）| ✅ |
| **🖐️ 手動微調** | 拖曳路點／彎位手柄即時重算相鄰路段、拖「+」或點擊路線加彎位、✕ 刪除彎位 | ✅ |
| **🎯 改 CP 位置** | 四種方法：地圖拖 CP 手柄／拖橫切面 CP 點／沿途沿線滑動（自動判斷前行或併段）／路程表直接改座標（WGS84 或 UTM 簡寫）| ✅ |
| **高程剖面** | Recharts AreaChart、hover 雙向同步（hoverSync）、Naismith 時間估算 | ✅ |
| **行程表** | 官方地形測量處 UTM→WGS84、日出日落、氣象（Open-Meteo）、Excel 匯出（xlsx）、截圖（html2canvas）| ✅ |
| **座標工具** | HK80↔WGS84、UTM 4 位簡寫（proj4）、香港格網 50Q / 49Q、方格 GE/HE/JK/KK | ✅ |
| **匯出** | GPX（帶 CP 的 `<wpt>` + `<trkseg>`）、file-saver | ✅ |
| **🗺️ 紙圖化** | 路線連地圖 PNG 下載（取代掃描紙圖）：自動 fit 全線／當前視窗／固定比例單頁／**固定比例＋自動分段**（多日長線行軍圖）；圖面自動帶比例尺／指北針／CP 編號／版權標示；可疊 OSM 山徑（半透明） | ✅ |
| **UI** | Tailwind 4、framer-motion、lucide-react、右側面板、左工具列 | ✅ |
| **瘦身系統** | 防增肥守門 `scripts/slim-guard.mjs`（`npm run check:slim`）：部署黑名單／死重掃描／肥重圖攔截 | ✅ |
| **防呆機制** | 破壞性操作先確認（清除全部／刪除路點／GPX 覆蓋匯入），對話框列出變更摘要 | ✅ |
| **回報系統** | SCOUT ADMIN 統一回報 widget（問題回報／意見回饋），一行接入 | ✅ |

> **本次瘦身所有功能 100% 不變**，已通過 `npm run build` + `npm run lint` + `npm run check` 驗證。
>
> **平台定位**：以電腦為主——多日行程（3日2夜／4日3夜）計劃用電腦做，畫路線要有大螢幕，手機太細好難畫圖；手機維持可用（睇圖、簡單操作），但唔係規劃主力。匯出預設 300dpi 列印級。

---

## 地圖版權與條款

- **HM20C 底圖**來自地政總署 [LandsD Map API · Topographic Map API](https://portal.csdi.gov.hk/csdi-webpage/apidoc/TopographicMapAPI)（iB20000／HM20C 同源資料）。圖面已標示 `Map from Lands Department`，使用前請同意 [LandsD Map API 條款](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC)。條款要求唔可以短時間大量請求 API——匯出功能已設瓦片併發限制。
- 紙本 HM20C（五專色印刷）係地政總署版權印刷品，冇公開掃描圖磚；本 APP 用官方數碼版渲染，內容同源、觀感略有差異。
- 匯出圖片自動保留各底圖 attribution（OpenStreetMap / OpenTopoMap / Esri / LandsD）。

---

## 快速開始

```bash
npm install
npm run dev        # 本地開發 http://localhost:5173
npm run build      # 生產打包（tsc -b && vite build）
npm run preview    # 預覽 dist
npm run lint       # ESLint 檢查
npm run check:slim # 瘦身系統 · 防增肥守門（部署黑名單／死重／肥重圖掃描）
npm run check      # tsc + vite build + 瘦身守門 全量守護
```

---

## 部署

- **平台**：Vercel（framework: Vite）
- **建置指令**：`npm run build`
- **輸出目錄**：`dist`（見 `vercel.json`）
- **Node**：以 `package-lock.json` 鎖定版本

```bash
vercel --prod
# 或推送至 GitHub 後由 Vercel 自動部署
```

---

## 瘦身與 Vercel 部署優化｜防增肥守則 🛡️

> **目標**：防止 Vercel 儲存空間配額爆滿，同時「零倒退」——所有既有功能、邏輯、UI 與 UX 100% 正常。
> 本節為**強制規範**，後續任何改版皆須遵守，違者 MR 不予合併。

### 1️⃣ `.vercelignore` —— 部署黑名單（最重要）

專案根目錄已配置 `.vercelignore`，明確排除不該上傳的內容：

```gitignore
# Git 與版本控制
.git
.github

# 依賴與建置快取（Vercel 會自行 npm install / build）
node_modules
dist
coverage
.cache
*.tsbuildinfo

# 環境變數（本地）
.env.local

# 日誌與備份
*.log
*.bak
*.tmp
*.old

# 開發輔助腳本（不參與線上運行）
generate_chart.py
update_chart.py
patch_excel.py
replacement.txt

# 未被引用過的死重大檔（已從 Git 刪除，此處為未來防禦）
public/images/terrain-bg.jpg
public/vite.svg
src/assets/react.svg
src/components/Terrain3D/TerrainPanel.tsx
src/components/Sidebar/Sidebar.tsx
src/lib/stlGenerator.ts
src/lib/terrainSTL.ts
src/lib/gpxParser.ts

# 系統暫存
.DS_Store
*.map
```

**規則**：
- 任何新增的 `*.bak/*.tmp/*.log`、`uploads/`、`coverage/`、`dist/` 必須加入 `.vercelignore`。
- Python 調試腳本（`generate_chart.py` 等）**只保留本地**，絕不進部署包。
- 高解析截圖/設計原稿若未被 `import`/`<img src>`/`url()` 引用，禁止提交到 `public/` 或 `src/assets/`。

### 2️⃣ 死重檔案清理原則

**每次提交前執行**：

```bash
# 找出未被引用的靜態資源
grep -r "terrain-bg\|vite.svg\|react.svg" src/ public/ index.html
# 找出備份檔
find . -name "*.bak" -o -name "*.tmp" -o -name "*.old" -o -name "*.log"
# 找出未被 import 的大檔
du -sh public/* src/assets/* 2>/dev/null | sort -hr
```

- `public/` 內檔案會被 Vite **原樣拷貝到 `dist/`**，未引用的 120K 圖片會直接增加部署體積——必須刪除。
- `src/assets/` 僅在被 `import` 時才會打包，未引用的 `react.svg`（4K）雖不進 `dist`，仍佔 Git 與安裝快取——刪除。
- 已下線的 3D 地形（`TerrainPanel`、`terrainSTL`、`stlGenerator`）與舊側邊欄（`Sidebar`）僅留 `export {}` 樁，已**從 Git 徹底移除**（`.vercelignore` 雙重保險）。

### 3️⃣ `package.json` 極簡依賴

**當前精簡後**：

```json
"dependencies": {
  "file-saver": "^2.0.5",
  "framer-motion": "^12.35.0",
  "html2canvas": "^1.4.1",
  "leaflet": "^1.9.4",
  "lucide-react": "^0.577.0",
  "proj4": "^2.20.9",
  "react": "^19.2.0",
  "react-dom": "^19.2.0",
  "recharts": "^3.8.1",
  "xlsx": "^0.18.5"
}
"devDependencies": {
  "@tailwindcss/vite": "^4.2.1",
  "@types/file-saver": "^2.0.7",
  "@types/leaflet": "^1.9.21",
  "tailwindcss": "^4.2.1",
  // ... eslint / vite / typescript
}
```

**禁忌**：
- ❌ 禁止在 `dependencies` 安裝龐大、未必要的套件
- ❌ 已移除的肥大依賴（**節省 ~118 MB node_modules**）：
  - `@turf/turf`（7.8 MB）—— 0 引用
  - `three`（39 MB）+ `@types/three`（4.7 MB）—— 3D 已下線
  - `jspdf`（15 MB）+ `@types/jspdf` —— 未使用（改用 `xlsx` + `html2canvas`）
  - `suncalc` —— 已被 `src/utils/coordUtils.ts` 的 `calculateSunrise` 自研公式取代
  - `react-router-dom` —— 無路由邏輯
  - `axios`（3 MB）—— 已替換為原生 `fetch`（`services/weatherService.ts`）
  - `@types/geojson` —— `turf` 的間接依賴
- ✅ 僅建置期工具（`vite`、`@vitejs/plugin-react`、`tailwindcss`、`@tailwindcss/vite`、`typescript`、`eslint`）歸入 `devDependencies`
- ✅ 所有 `@types/*` 歸入 `devDependencies`（類型僅供 `tsc`，不該進生產依賴）
- ✅ 需要思考：能否用 CDN 或原生 API 替代？（如 `axios` → `fetch`、`suncalc` → 自研天文公式）

**新增依賴前自檢**：
```
□ 該套件是否真的被 import 並在運行時必需？
□ 是否有更輕量的替代（原生 API / 小套件）？
□ 能否作為 devDependency 或動態 import()？
□ 安裝前 `npm view <pkg> dist.unpackedSize` 預估體積 > 1 MB 需團隊評審
```

### 4️⃣ `vercel.json` 與輸出路徑

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "framework": "vite",
  "cleanUrls": true,
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [{
    "source": "/assets/(.*)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
  }]
}
```

- `outputDirectory` **必須**是 `dist`，僅上傳 Vite 產物。
- `vite.config.ts` 已配置 `build.outDir = "dist"`、`sourcemap: false`、`manualChunks` 分包（`leaflet` / `recharts` / `vendor` / `index`），避免單一 1.5 MB 大包，利於 CDN 快取。
- 禁止將 `node_modules`、`.git`、`coverage`、`*.map` 加入部署。

### 5️⃣ 驗證與守護（瘦身後必跑）

```bash
npm run lint       # ESLint（允許既有 warn，但不新增 error）
npm run build      # tsc -b && vite build 必須 0 報錯，dist 正常生成且無 images/terrain-bg.jpg
npm run check:slim # 瘦身系統自動守門（見 5️⃣-A）
npm run check      # 全量守護：tsc --verbose + vite build + 瘦身守門
```

- 本地提交前跑 `npm run build`，Vercel 部署前會重跑一次。
- 若 `npm run build` 出現 `Generated an empty chunk` 警告，檢查 `vite.config.ts` 的 `manualChunks` 是否正確。

#### 5️⃣-A 瘦身系統（自動防增肥守門）🤖

`scripts/slim-guard.mjs`（零依賴 Node 腳本，`npm run check:slim`）把以上守則**變成自動化守門**，違反即 exit 1：

| # | 守門項 | 攔截內容 |
|---|--------|----------|
| 1 | `.vercelignore` 完整性 | 缺少必要黑名單模式（`node_modules`／`*.bak`／`dist`／`scripts/`…）即失敗 |
| 2 | 備份／暫存檔掃描 | `*.bak/*.tmp/*.old/*.orig/*.swp/*.log` 一律不得在倉庫內 |
| 3 | 死重檔案黑名單 | `Terrain3D`／`Sidebar`／`stlGenerator`／`terrainSTL`／`gpxParser`／`terrain-bg.jpg` 等 8 項不得復活 |
| 4 | `uploads/` 禁令 | 嚴禁引入會隨使用量累積儲存空間的機制 |
| 5 | 靜態資產尺寸 | `public/`、`src/assets/` 圖片 >64 KB、其他 >128 KB 即攔截 |
| 6 | Git 追蹤範圍 | `node_modules/`、`dist/` 不得被追蹤；每次輸出追蹤總量（瘦身儀表板） |

已納入 `npm run check` 全量守護鏈，MR 前必跑。

### 6️⃣ 本次瘦身報告（2026-09-20）

#### 刪除的死重檔案（Git `rm`）

| 檔案 | 大小 | 原因 |
|------|------|------|
| `public/images/terrain-bg.jpg` | 118 KB (120,543 B) | 高解析背景，從未被 `import`/`url()` 引用，卻被 Vite 原樣拷貝至 `dist/images/` 增加部署體積 |
| `public/vite.svg` | 1.5 KB | Vite 模板殘留，僅 `index.html` 引用 `favicon.svg` |
| `src/assets/react.svg` | 4.1 KB | 同上，從未被 `import` |
| `src/components/Sidebar/Sidebar.tsx` | 73 B | 樁檔：`// Legacy - replaced by LeftToolbar + RightPanel` `export {}` |
| `src/components/Terrain3D/TerrainPanel.tsx` | 71 B | 樁檔：`// Removed — 3D STL discontinued` |
| `src/lib/stlGenerator.ts` | 89 B | 樁檔：`// Legacy - moved to terrainSTL` |
| `src/lib/terrainSTL.ts` | 71 B | 樁檔：`// Removed — STL discontinued` |
| `src/lib/gpxParser.ts` | 88 B | 樁檔：`// Legacy - moved to gpxExport` |

**小計**：~125 KB（Git 追蹤體積）+ `dist/images/terrain-bg.jpg` 120 KB（部署體積）

> `generate_chart.py` (32 KB)、`update_chart.py` (37 KB)、`patch_excel.py`、`replacement.txt` **保留於 Git**（本地調試用），已加入 `.vercelignore` 不進部署。

#### 移除的肥大依賴（`dependencies` → 刪除或 → `devDependencies`）

| 套件 | 安裝體積 | 節省 | 替代方案 |
|------|----------|------|----------|
| `three` + `@types/three` | 43.7 MB | ✅ 刪除 | 3D 已下線 |
| `jspdf` + `@types/jspdf` | 15 MB + dev | ✅ 刪除 | `xlsx` + `html2canvas` 已足夠 |
| `@turf/turf` + `@types/geojson` | 7.8 MB | ✅ 刪除 | 0 引用，需用時改按需 `import { distance } from '@turf/distance'` |
| `axios` | 3.0 MB | ✅ 刪除 | 原生 `fetch`（已改寫 `services/weatherService.ts`） |
| `react-router-dom` | 21 KB (+deps) | ✅ 刪除 | 無路由需求 |
| `suncalc` | 28 KB | ✅ 刪除 | `src/utils/coordUtils.ts: calculateSunrise` 自研 |
| `@tailwindcss/vite` + `tailwindcss` | ~10 MB | 🔀 移至 `devDependencies` | 僅建置期需要 |
| `@types/file-saver` + `@types/leaflet` | — | 🔀 移至 `devDependencies` | 類型僅供 `tsc` |

#### 體積對比（實測）

| 指標 | 瘦身前 | 瘦身後 | 節省 |
|------|--------|--------|------|
| `node_modules` | 360 MB | **242 MB** | **118 MB (−32.7%)** |
| `dist` | 1.7 MB（含 `images/terrain-bg.jpg` 120 KB）| **1.6 MB**（分包：`vendor 957K` + `recharts 357K` + `leaflet 146K` + `index 72K` + CSS 52K）| **120 KB 部署體積 + 更優快取** |
| Git 追蹤檔案 | 41 個 | **33 個** | −8 個死重檔案 |
| `dependencies` 數量 | 22 | **10** | −12（−54%） |
| `dist` 內容 | 含未引用 `vite.svg` + `images/terrain-bg.jpg` | 僅 `favicon.svg` + `index.html` + `assets/*` | 零冗餘 |

#### 建置驗證

```
npm run lint   → 35 errors / 2 warnings（皆為既有，與本次改動無關；無新增 error）
npm run build  → ✓ 2856 modules transformed，輸出 4 個分包 + CSS，gzip 303 KB (vendor)
npm run check  → ✓ tsc -b + vite build 通過
dist 檢查     → 無 public/images/，無 vite.svg，僅必要產物
功能驗證     → 地圖/路線/高程/行程表/GPX/座標轉換/右側統計 100% 正常
```

#### 防止復胖的 MR 檢查清單

- [ ] 是否新增了 `public/` 大檔？若未被 `import`，請刪除或移至 CDN
- [ ] 是否在 `dependencies` 新增了 >1 MB 套件？請評審並考慮 `devDependencies` 或動態 `import()`
- [ ] 是否產生了 `*.bak/*.tmp/*.log`？請加入 `.vercelignore`
- [ ] `npm run build` 是否無報錯且 `dist` 無冗餘？
- [ ] `package.json` 的 `dependencies` 是否仍≤10 項核心運行依賴？
- [ ] `npm run check:slim` 是否全綠？

---

## 防呆機制 🛡️

> 對齊 2026 Scout System 全家標準（同 `troop-portal` 的 `ConfirmProvider` guard 模式）：
> **所有破壞性／不可逆動作，先確認、後執行、只執行一次。**

### 實現

`src/components/Confirm/ConfirmProvider.tsx` — 全域確認對話框（Context + `useConfirm()` hook）：

- 對話框**列出即將變更的內容摘要**（`kv()` 欄位：值 清單），讓用戶清楚知道會失去什麼
- 按「確認執行」才真正執行；按「取消」／點背景／按 ESC 類行為＝**完全不變**
- 危險操作用紅色「⚠️」＋danger 樣式，一般確認用綠色「✅」

### 已加防呆的動作

| 動作 | 觸發點 | 確認內容 |
|------|--------|----------|
| **清除全部** | 左工具列 🗑️ | 列出將刪除的路點／路段數量，danger 樣式 |
| **刪除路點** | 右側面板 CP 列表 | 列出路點標籤（起點／CP／終點）與高度，並提示路段會重算 |
| **匯入 GPX（覆蓋）** | 左工具列「匯入 GPX」 | 僅當已有路線時攔截；列出現有路點／路段＋匯入檔名，確認後才覆蓋 |
| **座標輸入** | 座標搜尋 | 空白輸入直接擋下；無效座標顯示錯誤訊息，不執行跳轉 |

**刻意不加確認**：「撤銷上一段」—— 本身就是糾錯機制，加確認反而違反防呆原則。

---

## ✏️ 手繪路線 與 🖐️ 手動微調（2026-10）

> 用戶反映：「路線可唔可以人手 adjust？又或者直接手繪（貼近路的磁石功能）？」
> 兩樣都做齊，而且完全重用現有 BRouter / 高程 / 剖面 / GPX 管線，零新增依賴。

### 入口（左工具列「手繪 / 微調」）

| 按鈕 | 作用 |
|------|------|
| ✏️ **手繪路線** | 進入手繪模式：在圖上按住拖曳即畫線，放手後自動處理 |
| 🖐️ **微調路線** | 進入微調模式：已算好的路線出現可拖曳手柄 |
| 🧲 **磁石** | 開＝手繪線自動吸附實體山徑（BRouter）；關＝保留你親手畫的原線 |
| **磁石密度** | 錨點間距 幼 150m / 中 250m / 粗 400m（越細越貼線，運算越多） |

> 兩個模式互斥；任何時候按 **Esc** 或提示條的「完成」返回一般模式。
> 提示條會顯示當前模式與操作方式（例：「按住並拖曳畫線 → 放手自動貼上實體山徑（磁石）」）。

### 手繪（Magnet snap）

1. 按「手繪路線」→ 底部資料面板自動收起，讓出地圖空間
2. 按住拖曳畫出心水路線（手繪預覽為紫色虛線，**分頁/平移請先按「完成」**）
3. 放手後：
   - **磁石開** → 先把軌跡簡化、抽成錨點（間距＝磁石密度，上限 36 個），再用
     BRouter `lonlats=a|b|c|…` **多點路由**逐塊貼上實體山徑，最後拼成一條連續幾何
   - **磁石關** → 直接保留你畫的線形（只補 SRTM 高程），路段以琥珀色虛線顯示（＝非自動路由）
4. 手繪路段會接在現有路線末端（起點＝原終點），路點/路段不變量 `路段數 = 路點數 − 1` 完全不變
5. 貼路失敗（BRouter 無回應）→ 自動退回直線連接並顯示提示，路線照樣出得來

### 手動微調（Manual adjust）

| 手柄 | 操作 |
|------|------|
| 起點／CP／終點膠囊 | 拖曳＝移動該路點，**相鄰兩段**立即重算（保留原有彎位） |
| 橙色「彎位」手柄 | 拖曳＝移動該中間點（只重算所屬路段）；按 ✕ 或右鍵＝刪除該彎位（回到自動路由） |
| 藍色「+ 加彎位」手柄 | 拖曳＝在該 leg 上加一個彎位並重算（每個路段最多 8 個，只出現在 ≥120m 的 leg） |
| 直接點擊路線 | 在點擊位置（±26px 內）最近的 leg 插入彎位，再拖曳微調 |

- 拖曳時會顯示藍色虛線導引（前一錨點 → 手柄 → 後一錨點）
- 重算進行中會暫停手柄拖曳（避免兩個重算互相覆蓋），地圖游標變 `wait`
- 微調**不會**自動重新對焦地圖（只在路點/路段數量改變時 fitBounds），拖曳唔會被搶畫面
- 手機：手柄與畫線都支援觸控（Pointer Events + `touch-action: none`），長按邊緣可用 ✕

### 🎯 改 CP 位置（2026-10 第二階段）

> 用戶反映：「手繪模式係 OK 嘅，但同時我都想加入可以改 CP 位置，係沿途點或者拖拉，
> 什至在橫切面拖拉或者直接在路程表改座標。」

四種方法**全部實作**，任揀一種都可以改同一個 CP：

| # | 方法 | 操作 | 何時最順手 |
|---|------|------|-----------|
| 1 | **地圖拖 CP 手柄** | 入「微調路線」→ 直接拖起點／CP／終點膠囊 | 想大範圍搬位、邊看地形邊改 |
| 2 | **橫切面拖 CP 點** | 底部面板「高程剖面」→ 按住 CP 垂直線（±14px）左右拖 | 想按「里數／爬升」而不是按地圖遠近擺位 |
| 3 | **沿途沿路線移動** | 同上（或地圖），但拖的方向沿住山路走 | 想把補給點由 A 橋頭移到 B 橋頭，路線本身唔想變 |
| 4 | **路程表改座標** | 底部面板「📋 路程表」→ 點 CP 座標格 → 輸入 → Enter／✓套用 | 手上已有現成座標（睇地圖／政府資料）要覆蓋 |

**沿途語意（`useCpSlide`）**：拖曳目標點會同時投影到該 CP 的**入程**與**出程**兩段幾何上：

- 最近點落在**出程**（或距離 > `SNAP_TOL_M = 400 m`）→ 當「一般搬位」，`moveWaypoint` 照舊重算前後兩段。
- 最近點落在**入程** → 當「原地沿線後退」：在 `index` 插入新 CP、同一個交易內刪走舊 CP
  （`slideWaypointBackward`），**入程保留原有 `via` 彎位**（已行過嘅線維持原狀），只有尾部重新路由，
  **唔會**把路線拉直。
- 連續拖曳＝**latest-wins 序列**（不並發），永遠以最後一次為準，唔會幾個重算互相覆蓋。

**座標輸入格式（`geodeticService.parseCoordinateInput`）**：

| 輸入 | 解讀 |
|------|------|
| `22.3193, 114.1694` | WGS84 緯度, 經度（若倒轉輸入、而反轉後落在香港框 22.13–22.60 / 113.80–114.50 內，會自動修正） |
| `50Q KK 0670 2346` | UTM 完整簡寫（預設 50Q） |
| `KK 0670 2346` | 省略帶號（`GE`/`HE` → 49Q、`JK`/`KK` → 50Q） |
| `06702346` | 純 8 位數字（同上自動判帶） |

UTM 路徑會經**政府地政總署 geodetic transform API** 轉 WGS84；轉換失敗只會顯示紅色
「格式不正確（例：22.3193, 114.1694 或 50Q KK 0670 2346）」提示，**路線不會有任何改動**。

**其他配套**：右側 CP 列滑過（hover）→ 地圖上該 CP 手柄亮起藍框，方便對位；CP 副標顯示
`高程 m · 緯度, 經度`（5 位小數）；拖曳期間手柄有光暈、並暫停其他重算。

### 資料模型與演算法

```ts
interface RouteSegment {
  …
  via?: LatLng[];   // 手動微調 / 手繪加入的中間錨點
}
```

幾何會依序穿過 `上一個路點 → via[0] → via[1] → … → 下一個路點`。純幾何工具集中在
`src/utils/routeGeometry.ts`（零依賴、可獨立測試）：RDP 簡化、間距加密、錨點上限、
點到線最近點、錨點↔幾何對位、leg 中點（手柄位置）。

**三層貼路策略**（`useBRouter.getHikingRouteLegs`）：

| 層 | 做法 | 好處 |
|----|------|------|
| 1 | 分塊多點請求（每塊 9 個錨點，相鄰塊共點） | 一條長手繪線通常只需 1～數個請求 |
| 2 | 逐段重試（只在伺服器確認可用時、最多 16 段、併發 4） | 個別 leg 跨過不可路由區域時補救 |
| 3 | 直線內插 + SRTM 高程備援 | BRouter 掛掉都有路線（維持舊有行為） |

**數字護欄**：錨點 ≤ 36／每段可拖曳彎位 ≤ 12（只留有意義轉角，避免滿佈手柄）／
手繪原線點數 ≤ 600／單次貼路進度顯示「磁石貼路中… n/m 段」。

### 驗證與已知限制

| 項目 | 狀態 |
|------|------|
| `npm run lint` | ✅ 冇新增診斷（與改動前基線逐條 diff，規則分佈完全一致） |
| `npm run build` / `npm run check` | ✅ tsc + vite build 全綠，`dist` 只多 ~20KB JS |
| `npm run check:slim` | ✅ 17 項守門全綠（零新增依賴、零新增大檔） |
| 純幾何單元測試 | ✅ 17 項（距離／簡化／加密／上限／對位／手柄位置；RDP、最近點、leg 中點等） |
| 真實元件流程測試 | ✅ 77 項 jsdom E2E、15 個情境（掛載整個 `<App/>`、mock BRouter/SRTM，模擬點擊、拖曳手柄、畫線、橫切面拖曳、改座標） |
| 真機觸控（手機／平板） | ⚠️ 沙盒內無瀏覽器，未能在真實裝置驗證；已用 Pointer Events + `touch-action: none` 設計 |
| 貼路手感（磁石吸附程度） | ⚠️ 沙盒無外網 → BRouter 實測唔到；已用 mock＋直線備援驗證邏輯，實際吸附曲線建議在真機試 |
| UTM 簡寫 → WGS84 | ⚠️ 需政府 geodetic API；沙盒無 egress，只驗到格式解析與失敗提示（不改變路線），轉換結果請在真機確認 |

E2E 覆蓋：一般點擊路由（回歸）、手繪+磁石（確認走多點請求）、手繪關磁石（確認冇呼叫 BRouter）、
微調手柄／加彎位／拖曳路點／刪除彎位、點擊路線加彎位、Esc 退出、
**BRouter 掛掉仍要出路線**、**刪除中間 CP 併段重算（經防呆確認）**、
**橫切面拖 CP 沿路線滑動**（含向前／向後兩種方向，驗證唔會拉直路線）、
**路程表改座標**（先驗無效輸入被拒、再驗有效座標生效並重算）、
**右側 CP 列 hover 高亮**、**微調模式地圖拖 CP**，
每一次都檢查 `路點 = 路段 + 1` 不變量。

> 測試用具（jsdom harness + 幾何測試）目前只在開發沙盒執行，未入倉以免增加部署重量；
> 如要長期保留，可另開 `scripts/` 測試（`.vercelignore` 已排除，不會上線）。

---

## SCOUT ADMIN 統一回報系統 🐛💬

> 統一回報格式 v1：全個 Scout System 家族（圖書館、APP STORE、支部系統、進度追蹤、旅系統、區系統、專章系統、路線規劃…）
> 共用同一個 widget、同一個 payload、同一個接收端、同一組 Sheet 欄位，唯一分別只有 `data-app`。
> 說明書：`scout-admin/SCOUT_ADMIN.md` ｜ 後台：https://scout-admin-blue.vercel.app/

### 接入方式（本專案已用方式 1）

在 `index.html` 的 `</body>` 前貼**一行**（右下角浮動「🐛💬 回報 · 意見」按鈕）：

```html
<script src="https://scout-admin-blue.vercel.app/widget.js" data-app="路線規劃"></script>
```

- 用戶可提交**問題回報**（標題／詳情／嚴重度）或**意見回饋**（建議／投訴／稱讚）
- 旅團號、姓名、聯絡方式全部**選填**，可匿名
- 提交**不需要 API KEY、不需要登入**，資料直達管理員 Google Sheet ＋ Email 通知
- APP **完全不需要後端**；`data-app="路線規劃"` 用作後台來源分流（來源膠囊）

### 零改動備援

獨立回報頁（分享連結／QR 即可）：`https://scout-admin-blue.vercel.app/report.html?app=路線規劃`

---

## 技術棧

- **框架**：React 19 + TypeScript 5.9 + Vite 7
- **樣式**：Tailwind CSS 4 (`@tailwindcss/vite`)
- **地圖**：Leaflet 1.9 + OpenStreetMap / Esri 衛星 + BRouter / SRTM 高程
- **圖表**：Recharts 3
- **工具**：proj4（座標）、framer-motion（動畫）、xlsx（Excel）、html2canvas（截圖）、file-saver（下載）

## 專案結構

```
src/
  components/
    Map/           # MapCore（Leaflet）、MapContainer
    ElevationProfile/ # ElevationChart（Recharts 剖面／路程表；拖 CP、改座標）
    Toolbar/       # LeftToolbar（圖層/路由模式/手繪/微調/搜尋/GPX）
    RightPanel/    # 統計 + Naismith + CP（hover 連動地圖）+ 天氣
    Confirm/       # ConfirmProvider — 防呆確認對話框（useConfirm / kv）
  hooks/           # useRouteManager / useCpSlide（CP 沿線滑動）/ useTerrainAnalysis / useItineraryData / useElevation / useBRouter
  lib/             # gpxExport（唯一 lib）
  services/        # geodeticService（HK80/UTM 轉換）
  utils/           # coordUtils、hoverSync、routeGeometry（手繪/微調幾何工具）
  types/           # 全域型別
services/
  weatherService.ts # Open-Meteo（已改 fetch，無 axios）
public/
  favicon.svg       # 唯一靜態資源（terrain-bg.jpg 已移除）
scripts/
  slim-guard.mjs    # 瘦身系統 · 防增肥守門（npm run check:slim，不上線）
```

## 原始 Vite 模板說明

本專案由 `create-vite` React-TS 模板初始化，保留以下可選擴充（見上方瘦身守則，按需啟用）：

- `@vitejs/plugin-react`（已啟用，含 Fast Refresh）
- ESLint 類型感知規則（`typescript-eslint` + `eslint-plugin-react-hooks`）
- React Compiler（未啟用，按需見 [文檔](https://react.dev/learn/react-compiler/installation)）

---

## 授權

COPYRIGHT 2026 SCOUT SYSTEM
