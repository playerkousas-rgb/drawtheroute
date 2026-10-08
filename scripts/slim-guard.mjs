#!/usr/bin/env node
/**
 * 瘦身系統 — 防增肥守門（2026 Scout System 全家標準）
 *
 * 對齊 upgrade/scripts/check.js 的「防增肥守門」思路：
 * 每次提交／部署前自動攔截肥重與死重，防止 Vercel 配額爆滿。
 * 零依賴、純 Node 執行：`npm run check:slim`
 *
 * 守門規則（違反即 exit 1）：
 *  1. `.vercelignore` 必須存在，且包含必要黑名單模式
 *  2. `scripts/`、`*.md`、測試／調試產物絕不進部署包
 *  3. 倉庫內不得出現備份／暫存檔（*.bak/*.tmp/*.old/*.orig/*.swp/*.log）
 *  4. 不得出現 `uploads/`（會隨使用量累積儲存空間的機制）
 *  5. 已廢棄死重檔案不得復活（Terrain3D / Sidebar / stlGenerator / terrainSTL / gpxParser）
 *  6. `public/`、`src/assets/` 單檔超標即失敗（圖片 >64KB、其他 >128KB）
 *  7. `node_modules/`、`dist/` 不得被 git 追蹤
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const problems = [];
const warns = [];
let checked = 0;

const ok = (msg) => { checked++; console.log(`  ✅ ${msg}`); };
const fail = (msg) => { problems.push(msg); console.log(`  ❌ ${msg}`); };
const warn = (msg) => { warns.push(msg); console.log(`  ⚠️  ${msg}`); };

// ── 1. .vercelignore 必須存在且涵蓋關鍵模式 ──────────────────────────────
console.log('\n【瘦身系統 · 防增肥守門】');
console.log('\n1️⃣  .vercelignore 部署黑名單');
const REQUIRED_IGNORE = [
  'node_modules', '.git', '*.log', '*.bak', '*.tmp', '*.old', '*.swp',
  'dist', '.DS_Store', 'Thumbs.db', '*.map',
];
const ignorePath = join(ROOT, '.vercelignore');
if (!existsSync(ignorePath)) {
  fail('.vercelignore 不存在 — 部署會把死重檔案全部上傳');
} else {
  const ign = readFileSync(ignorePath, 'utf8');
  for (const pat of REQUIRED_IGNORE) {
    if (ign.includes(pat)) ok(`已排除 ${pat}`);
    else fail(`.vercelignore 缺少必要模式：${pat}`);
  }
  // 開發輔助腳本絕不進部署包
  if (/^scripts\/?\s*$/m.test(ign) || ign.includes('scripts')) ok('已排除 scripts/（守門腳本不上線）');
  else fail('.vercelignore 缺少 scripts/ — 守門腳本不應進部署包');
}

// ── 2. 備份／暫存檔掃描 ─────────────────────────────────────────────────
console.log('\n2️⃣  備份／暫存檔掃描（*.bak/*.tmp/*.old/*.orig/*.swp/*.log）');
const BAD_EXT = new Set(['.bak', '.tmp', '.old', '.orig', '.swp', '.swo', '.log']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.vercel', '.idea', '.vscode']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allFiles = walk(ROOT);
const badFiles = allFiles.filter(f => BAD_EXT.has(extname(f).toLowerCase()) || f.endsWith('~'));
if (badFiles.length === 0) ok('沒有備份／暫存檔');
else badFiles.forEach(f => fail(`發現備份／暫存檔：${relative(ROOT, f)} — 請刪除，用 Git 做版本控制`));

// ── 3. uploads/ 與死重檔案黑名單 ─────────────────────────────────────────
console.log('\n3️⃣  uploads/ 與已廢棄死重檔案');
if (allFiles.some(f => f.includes(`${join(ROOT)}${'/'}uploads${'/'}`) || relative(ROOT, f).startsWith('uploads/'))) {
  fail('發現 uploads/ — 嚴禁引入會持續累積儲存空間的機制');
} else ok('沒有 uploads/');
const DEAD_STUBS = [
  'src/components/Terrain3D/TerrainPanel.tsx',
  'src/components/Sidebar/Sidebar.tsx',
  'src/lib/stlGenerator.ts',
  'src/lib/terrainSTL.ts',
  'src/lib/gpxParser.ts',
  'public/images/terrain-bg.jpg',
  'public/vite.svg',
  'src/assets/react.svg',
];
let deadAlive = 0;
for (const f of DEAD_STUBS) {
  if (existsSync(join(ROOT, f))) { fail(`已廢棄死重檔案復活：${f}`); deadAlive++; }
}
if (deadAlive === 0) ok(`已廢棄檔案零復活（${DEAD_STUBS.length} 項黑名單）`);

// ── 4. 靜態資產尺寸守門 ──────────────────────────────────────────────────
console.log('\n4️⃣  靜態資產尺寸守門（public/ + src/assets/）');
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const IMG_LIMIT = 64 * 1024;   // 對齊 upgrade 守則：圖片 >64KB 攔截
const FILE_LIMIT = 128 * 1024; // 其他靜態檔上限
let fatCount = 0;
for (const base of ['public', 'src/assets']) {
  const dir = join(ROOT, base);
  if (!existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const size = statSync(f).size;
    const limit = IMG_EXT.has(extname(f).toLowerCase()) ? IMG_LIMIT : FILE_LIMIT;
    if (size > limit) {
      fail(`肥重檔案：${relative(ROOT, f)}（${(size / 1024).toFixed(1)} KB > ${(limit / 1024).toFixed(0)} KB）`);
      fatCount++;
    }
  }
}
if (fatCount === 0) ok(`無超標靜態資產（圖片 ≤64KB、其他 ≤128KB）`);

// ── 5. git 不得追蹤 node_modules / dist ──────────────────────────────────
console.log('\n5️⃣  Git 追蹤範圍');
try {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const leaked = tracked.filter(f => f.startsWith('node_modules/') || f.startsWith('dist/'));
  if (leaked.length === 0) ok('node_modules/、dist/ 未被 git 追蹤');
  else leaked.slice(0, 5).forEach(f => fail(`git 不應追蹤：${f}`));

  // 追蹤總量報告（瘦身儀表板）
  let total = 0;
  for (const f of tracked) {
    try { total += statSync(join(ROOT, f)).size; } catch { /* 檔案已刪 */ }
  }
  console.log(`  📦 Git 追蹤總量：${(total / 1024).toFixed(0)} KB（${tracked.length} 檔）`);
} catch {
  warn('無法讀取 git ls-files（非 git 倉庫？），跳過追蹤範圍檢查');
}

// ── 結果 ─────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────`);
if (problems.length === 0) {
  console.log(`✅ 瘦身守門通過：${checked} 項檢查全綠${warns.length ? `（${warns.length} 提示）` : ''}`);
  process.exit(0);
} else {
  console.log(`❌ 瘦身守門失敗：${problems.length} 項違規`);
  for (const p of problems) console.log(`   · ${p}`);
  process.exit(1);
}
