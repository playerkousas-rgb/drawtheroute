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
- 用戶將新版 `canvas-app.html` 貼入 Gemini Canvas 即可；DTR 生產 bridge 唔使改。
