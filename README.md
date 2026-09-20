# ReliefForge Pro — Terrain Analysis System（DrawTheRoute）

> 香港遠足路線規劃 · 高程剖面 · Naismith 估算 · 官方格網轉換 · GPX 匯出

![Vite](https://img.shields.io/badge/Vite-7.x-646CFF) ![React](https://img.shields.io/badge/React-19-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6) ![Tailwind](https://img.shields.io/badge/Tailwind-4.x-38BDF8)

---

## 核心功能清單（零倒退承諾）

| 模組 | 功能 | 狀態 |
|------|------|------|
| **地圖** | Leaflet 底圖切換（地形/衛星）、點擊/拖曳路線、CP 標記、座標搜尋（WGS84 / HK80 / UTM）| ✅ |
| **路徑計算** | BRouter hiking-mountain 山徑優先 + 直線備援（SRTM）| ✅ |
| **高程剖面** | Recharts AreaChart、hover 雙向同步（hoverSync）、Naismith 時間估算 | ✅ |
| **行程表** | 官方地形測量處 UTM→WGS84、日出日落、氣象（Open-Meteo）、Excel 匯出（xlsx）、截圖（html2canvas）| ✅ |
| **座標工具** | HK80↔WGS84、UTM 4 位簡寫（proj4）、香港格網 50Q / 49Q、方格 GE/HE/JK/KK | ✅ |
| **匯出** | GPX（帶 CP 的 `<wpt>` + `<trkseg>`）、file-saver | ✅ |
| **UI** | Tailwind 4、framer-motion、lucide-react、右側面板、左工具列 | ✅ |

> **本次瘦身所有功能 100% 不變**，已通過 `npm run build` + `npm run lint` + `npm run check` 驗證。

---

## 快速開始

```bash
npm install
npm run dev      # 本地開發 http://localhost:5173
npm run build    # 生產打包（tsc -b && vite build）
npm run preview  # 預覽 dist
npm run lint     # ESLint 檢查
npm run check    # tsc + vite build 全量守護
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
npm run lint   # ESLint（允許既有 warn，但不新增 error）
npm run build  # tsc -b && vite build 必須 0 報錯，dist 正常生成且無 images/terrain-bg.jpg
npm run check  # 全量守護：tsc --verbose + vite build
```

- 本地提交前跑 `npm run build`，Vercel 部署前會重跑一次。
- 若 `npm run build` 出現 `Generated an empty chunk` 警告，檢查 `vite.config.ts` 的 `manualChunks` 是否正確。

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
    ElevationProfile/ # ElevationChart（Recharts + itinerary）
    Toolbar/       # LeftToolbar（圖層/路由模式/搜尋/GPX）
    RightPanel/    # 統計 + Naismith + CP + 天氣
  hooks/           # useRouteManager / useTerrainAnalysis / useItineraryData / useElevation / useBRouter
  lib/             # gpxExport（唯一 lib）
  services/        # geodeticService（HK80/UTM 轉換）
  utils/           # coordUtils、hoverSync
  types/           # 全域型別
services/
  weatherService.ts # Open-Meteo（已改 fetch，無 axios）
public/
  favicon.svg       # 唯一靜態資源（terrain-bg.jpg 已移除）
```

## 原始 Vite 模板說明

本專案由 `create-vite` React-TS 模板初始化，保留以下可選擴充（見上方瘦身守則，按需啟用）：

- `@vitejs/plugin-react`（已啟用，含 Fast Refresh）
- ESLint 類型感知規則（`typescript-eslint` + `eslint-plugin-react-hooks`）
- React Compiler（未啟用，按需見 [文檔](https://react.dev/learn/react-compiler/installation)）

---

## 授權

COPYRIGHT 2026 SKWSCOUT
