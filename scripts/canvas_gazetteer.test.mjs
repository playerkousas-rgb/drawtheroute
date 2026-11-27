import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../canvas-app.html', import.meta.url), 'utf8');

test('canvas-app gazetteer 已注入且冇 placeholder', () => {
  assert.ok(!html.includes('__GAZETTEER__'), 'placeholder 必須被取代');
  const m = html.match(/const GAZETTEER = (\[[\s\S]*?\]);/);
  assert.ok(m, '要有 GAZETTEER');
  const g = JSON.parse(m[1]);
  assert.ok(g.length >= 41, '至少包含 41 個官方營地');
});

test('關鍵西貢營地座標必須係 AFCD 官方數值（唔係 AI 估）', () => {
  const m = html.match(/const GAZETTEER = (\[[\s\S]*?\]);/);
  const g = JSON.parse(m[1]);
  const expected = {
    '猴塘溪營地': [22.441557, 114.327243],
    '大灘營地': [22.437525, 114.333411],
    '嶂上營地': [22.428510, 114.309811],
    '灣仔南營地': [22.461614, 114.342129],
    '灣仔西營地': [22.465078, 114.338103],
    '北潭凹營地': [22.423100, 114.335990],
    '黃石營地': [22.434970, 114.336420],
    '西灣營地': [22.399380, 114.369800],
    '鹹田灣營地': [22.409340, 114.375150],
    '浪茄灣營地': [22.373630, 114.374920]
  };
  for (const [name, [lat, lon]] of Object.entries(expected)) {
    const p = g.find(x => x.name === name);
    assert.ok(p, '缺少 ' + name);
    assert.ok(Math.abs(p.lat - lat) < 0.001, name + ' lat 偏離官方');
    assert.ok(Math.abs(p.lon - lon) < 0.001, name + ' lon 偏離官方');
    assert.ok(/AFCD/.test(p.source), name + ' 來源必須係 AFCD');
  }
});

test('過夜營地必須 AFCD 官方（唔准 AI 座標）；畫路 CP 可用網上座標但唔准用營地', () => {
  assert.ok(html.includes('AFCD 官方營地'), '過夜營地要指明官方');
  assert.ok(html.includes('role="overnight"'), '要有 overnight 角色');
  assert.ok(html.includes('過夜必須係 AFCD 官方營地'), 'resolveNamePlan 要強制過夜用官方營地');
  assert.ok(html.includes('嚴禁用營地做畫路 CP'), '唔准營地做畫路 CP 湊距離');
  assert.ok(html.includes('AI 網上查找'), '畫路 CP 來源要標明 AI 網上查找');
  assert.ok(html.includes('function validAiCoord('), '要有 AI 座標驗證（HK 範圍）');
  assert.ok(html.includes('function findPlaceExact('), '要有精確匹配，避免山峰名誤配營地');
  assert.ok(html.includes('唔好虛構'), '要禁止虛構座標');
  assert.ok(!html.includes('用你最接近嘅估計'), '唔可以再叫 AI 估座標');
});

test('有距離回饋循環（預設 3 round、成員可較 0–5）同停止掣', () => {
  assert.ok(html.includes('MAX_REFINE_ROUNDS=3'), '要有預設 3 round 上限');
  assert.ok(html.includes('maybeRefine'), '要有回饋循環');
  assert.ok(html.includes('btnStopRefine'), '要有停止掣');
  assert.ok(html.includes('id="fRefineCap"'), '要有成員可設定嘅調整次數欄');
  assert.ok(html.includes('function refineCap()'), '上限要由表格讀出');
  assert.ok(html.includes('Math.min(5,v)'), '上限要夾喺 0–5，唔可以無限');
  assert.ok(html.includes('refineRound>=cap'), '循環要用成員設定嘅上限');
});

test('表格優先：第一輪由表格直接生成，唔經 AI、唔塞晒所有營地', () => {
  assert.ok(html.includes('function buildPlanFromForm()'), '要有表格 plan builder');
  assert.ok(html.includes('id="fTarget"'), '要有目標公里欄');
  assert.ok(html.includes('id="fStart"') && html.includes('id="fFinish"'), '要有起終點欄');
  assert.ok(html.includes('btnAddDay') && html.includes('dayCamp'), '要有每日營地欄＋加日掣');
  assert.ok(!html.includes('id="req"'), '唔可以再係自由文本 prompt 優先');
  assert.ok(!html.includes('async function runAI()'), '第一輪唔可以再叫 AI 生成');
  assert.ok(html.includes('唔係要去晒嘅清單'), 'AI rules 要講明 gazetteer 唔係清單');
  assert.ok(html.includes('每次最多新增 2 個'), 'AI 每輪最多加 2 個中途點');
  assert.ok(html.includes('function checkFixed('), '要守住用戶固定點');
  assert.ok(html.includes('totalPts>prevPts+2'), '要有每輪 +2 點嘅 runtime 護欄');
});

test('有其他要求自由欄＋每日爬升上限＋手動 AI 調整（唔行樓梯／少啲上落）', () => {
  assert.ok(html.includes('id="fNotes"'), '要有「其他要求」自由欄');
  assert.ok(html.includes('id="fMaxAscent"'), '要有每日最多爬升欄');
  assert.ok(html.includes('maxAscentMPerDay'), '爬升上限要帶入 plan constraints');
  assert.ok(html.includes('id="btnNotesAdjust"'), '要有手動「AI 按其他要求調整」掣');
  assert.ok(html.includes('function manualAdjust()'), '要有手動調整函數');
  assert.ok(html.includes("c.id==='max_ascent_per_day'"), '回饋循環要讀爬升 criterion');
  assert.ok(html.includes('ascFail'), '爬升超標要觸發自動調整');
  assert.ok(html.includes('function applyAdjust('), '自動／手動調整要共用護欄');
  assert.ok(html.includes('唔保證完全冇樓梯'), '要誠實講明引擎唔保證避樓梯');
  assert.ok(html.includes('沿海低地中途點'), 'AI rules 要有低地／沿海揀點常識');
});

test('起終點可留空 → AI 補位；全部留空 → AI 自由發揮（唔再預填北潭涌）', () => {
  assert.ok(!html.includes('value="北潭涌"'), '起終點唔可以再預填北潭涌');
  assert.ok(html.includes('留空由 AI 揀'), '起終點欄要提示可留空');
  assert.ok(html.includes('if(!startName||!finishName)'), '留空起終點要行 AI 路徑');
  assert.ok(html.includes('async function runAiPlan()'), '要有 AI 補位規劃函數');
  assert.ok(html.includes('GEN_RULES'), '要有生成用 AI rules');
  assert.ok(html.includes('function skeletonFromPlan('), '要鎖定生成計劃骨架做固定點');
  assert.ok(html.includes('自由發揮揀一條合理路線'), '全部留空要俾 AI 自由發揮');
  assert.ok(html.includes('callGemini(spec, GEN_RULES)'), '生成路徑要用 GEN_RULES');
  // AI 補位仍然要守住固定點同點數上限
  assert.ok(html.includes('const ferr=checkFixed(np)'), 'AI 生成後要核對用戶填咗嘅點');
  assert.ok(html.includes('>24'), 'AI 生成計劃要守 24 點上限');
});

test('計完路會向 DTR 攞地圖大圖（map:snapshot）並顯示＋下載', () => {
  assert.ok(html.includes("send('map:snapshot'"), '要送 map:snapshot 請求');
  assert.ok(html.includes('map:snapshot-result'), '要接截圖結果');
  assert.ok(html.includes('map:snapshot-error'), '要處理截圖失敗');
  assert.ok(html.includes('id="mapImagePanel"'), '要有大圖面板');
  assert.ok(html.includes('download="DrawTheRoute-路線圖.png"'), '要有下載掣');
  assert.ok(html.includes('scheduleSnapshot()'), 'route:result 後要自動截圖');
});
