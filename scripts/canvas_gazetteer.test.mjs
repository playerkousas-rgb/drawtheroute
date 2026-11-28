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

test('有距離回饋循環（預設 6 round、成員可較 0–12）同停止掣', () => {
  assert.ok(html.includes('MAX_REFINE_ROUNDS=6'), '要有預設 6 round 上限');
  assert.ok(html.includes('maybeRefine'), '要有回饋循環');
  assert.ok(html.includes('btnStopRefine'), '要有停止掣');
  assert.ok(html.includes('id="fRefineCap"'), '要有成員可設定嘅調整次數欄');
  assert.ok(html.includes('function refineCap()'), '上限要由表格讀出');
  assert.ok(html.includes('Math.min(12,v)'), '上限要夾喺 0–12，唔可以無限');
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

test('Phase 3.7：官方準確座標（三角網測站＋標距柱）係自由選項，唔係優先；營地仍守 AFCD', () => {
  const trigM = html.match(/const TRIG_DATA=(\[[\s\S]*?\]);/);
  assert.ok(trigM, '要有 TRIG_DATA');
  const trig = JSON.parse(trigM[1]);
  assert.equal(trig.length, 231, '三角網測站要有 231 個');
  const dpM = html.match(/const DP_DATA=(\[[\s\S]*?\]);/);
  assert.ok(dpM, '要有 DP_DATA');
  const dp = JSON.parse(dpM[1]);
  assert.equal(dp.length, 940, '遠足徑標距柱要有 940 個');
  const tms = trig.find(r => r[1] === 'TAI MO SHAN');
  assert.ok(tms && Math.abs(tms[2] - 22.410093) < 0.001 && Math.abs(tms[3] - 114.124515) < 0.001, '大帽山座標要官方');
  const m020 = dp.find(r => r[0] === 'M020');
  assert.ok(m020 && Math.abs(m020[1] - 22.37011) < 0.001 && Math.abs(m020[2] - 114.37464) < 0.001, 'M020 座標要官方');
  assert.ok(html.includes('function findDistancePost('), '要有標距柱 lookup');
  assert.ok(html.includes('function findTrigStation('), '要有三角網測站 lookup');
  assert.ok(html.includes('const dp=findDistancePost(label);'), 'resolvePoint 要解析標距柱');
  assert.ok(html.includes('const tg=findTrigStation(label);'), 'resolvePoint 要解析三角網測站');
  assert.ok(html.includes('官方準確座標・自由選用'), 'prompt 要有自由選用段落');
  assert.ok(html.includes('冇話要優先邊種'), '要明言冇優先');
  assert.ok(html.includes('自由選擇，唔使刻意偏好任何一種'), '要強調自由選擇');
  assert.ok(html.includes('M001–M200') && html.includes('W001–W137') && html.includes('H001–H100') && html.includes('L001–L139'), '要畀標距柱編號範圍');
  assert.ok(!html.includes('優先使用三角網測站'), '唔可以叫 AI 優先使用三角網測站');
  assert.ok(!html.includes('優先揀三角網測站'), '唔可以叫 AI 優先揀三角網測站');
  assert.ok(!html.includes('優先使用標距柱'), '唔可以叫 AI 優先使用標距柱');
  assert.ok(html.includes('地政總署官方（三角網測站）'), '測站來源要標地政總署官方');
  assert.ok(html.includes('AFCD官方（標距柱）'), '標距柱來源要標 AFCD 官方');
  assert.ok(html.includes('_official'), '官方點要有 _official 旗標');
  assert.ok(html.includes('過夜必須係 AFCD 官方營地'), '過夜仍必須 AFCD 官方營地');
});

test('Phase 3.7 lookup 行為：海拔碰撞唔誤配、營地守衛、refine 按名重解析', () => {
  const a = html.indexOf('const GAZETTEER');
  const cut = html.indexOf('/* ═══════════════ 狀態 ═══════════════');
  const fn = new Function(html.slice(a, cut) + ';return {findTrigStation,findDistancePost,resolveNamePlan,findPlace};');
  const { findTrigStation, findDistancePost, resolveNamePlan, findPlace } = fn();
  // 海拔碰撞：「飛鵝山 605」嘅 605 係海拔，要解析去飛鵝山（137），唔係編號 605 嘅測站
  assert.equal(findTrigStation('飛鵝山 605')._stnNo, 137);
  assert.equal(findTrigStation('大帽山')._stnNo, 67.2);
  assert.equal(findTrigStation('三角網測站 87')._stnNo, 87);
  assert.equal(findTrigStation('M020'), null);
  assert.equal(findDistancePost('麥理浩徑 M020 標距柱')._postCode, 'M020');
  assert.equal(findDistancePost('C1101')._postCode, 'C1101');
  assert.equal(findDistancePost('大帽山'), null);
  // 營地守衛：測站唔可以做過夜營地
  const r = resolveNamePlan({ days: 2, nights: 1, start: { label: '北潭涌' }, waypoints: [{ id: 'c1', label: '大帽山', role: 'overnight' }, { id: 'f', label: '北潭凹', role: 'finish' }] });
  assert.ok(r.unresolved.some(u => u.includes('過夜必須係 AFCD 官方營地')), '測站唔可以做過夜營地');
  // 官方點解析
  const r2 = resolveNamePlan({ days: 1, nights: 0, start: { label: '北潭涌' }, waypoints: [{ id: 'cp1', label: 'M020', role: 'cp' }, { id: 'cp2', label: '大帽山', role: 'cp' }] });
  const cp1 = r2.plan.waypoints.find(w => w.id === 'cp1');
  const cp2 = r2.plan.waypoints.find(w => w.id === 'cp2');
  assert.ok(cp1._official && cp1._source.includes('AFCD'), 'M020 要官方');
  assert.ok(cp2._official && cp2._source.includes('地政總署'), '大帽山要官方');
  // refine：normalize 後嘅 label 重新解析仍攞到官方座標
  assert.equal(findDistancePost('M020（麥理浩徑）')._postCode, 'M020');
  assert.equal(findTrigStation('TAI MO SHAN（三角網測站 67.2）')._stnNo, 67.2);
  // 表單路徑
  assert.equal(findPlace('M020').kind, 'dp');
  assert.equal(findPlace('大帽山').kind, 'trig');
  assert.equal(findPlace('猴塘溪營地').kind, 'campsite');
});

test('Phase 3.8：貼路失敗＝可修理失敗（自動替換離網 CP），唔再放過直線備援；地理連貫守則', () => {
  // 舊嘅「fallback 就 stop＋warn」bail 必須移除
  assert.ok(!html.includes('唔會自動繞路'), '唔可以再見到 fallback 就放過嘅 bail');
  assert.ok(html.includes('const badLegs='), '要由 legs.snapped 計出事路段');
  assert.ok(html.includes('snapFail'), '要有貼路失敗旗標');
  assert.ok(html.includes('✗ 不合格'), '貼路失敗要標不合格');
  assert.ok(html.includes('呢個結果不可用、不可導航，只係候選預覽'), '結果面板要有不合格橫幅');
  assert.ok(html.includes('同一連接嘅山徑網絡'), 'prompt 要有地理連貫守則');
  assert.ok(html.includes('跨海／跨水塘'), 'prompt 要禁止跨海／跨水塘揀點');
});

test('Phase 3.8 maybeRefine 決策：fallback 触发修理／auto-off 標不合格／到上限標不合格／全貼路達標', () => {
  const src = html.slice(html.indexOf('function resultSummary'), html.indexOf('/* 手動：'));
  const factory = new Function('deps',
    'const {pendingPlan,stopRefine,currentNamePlan,notes,fixedLabels,originalRequest,setStatus,setConn,refineCap,callGemini,applyAdjust,$}=deps;'
    + 'let refineRound=deps.refineRound;' + src + ';return {maybeRefine,resultSummary};');
  const badResult = { total: { distanceM: 20000 }, days: [], fallbackUsed: true, criteria: [],
    legs: [{ snapped: false, from: { label: '北潭涌' }, to: { label: '萬宜水庫西壩' } }, { snapped: true, from: { label: '萬宜水庫西壩' }, to: { label: '上窰' } }] };
  const goodResult = { total: { distanceM: 40000 }, days: [], fallbackUsed: false, criteria: [],
    legs: [{ snapped: true, from: { label: 'a' }, to: { label: 'b' } }] };
  function run(result, over) {
    over = over || {};
    const calls = { status: [], prompts: [] };
    const deps = {
      pendingPlan: over.plan || { targetTotalKm: 40, constraints: { targetDistanceToleranceKm: 2 } },
      stopRefine: false, currentNamePlan: { waypoints: [] }, notes: () => '', fixedLabels: ['北潭涌'], originalRequest: '',
      refineRound: over.round || 0,
      setStatus: (c, m) => calls.status.push([c, m]), setConn: () => {},
      refineCap: () => (over.cap != null ? over.cap : 3),
      callGemini: p => { calls.prompts.push(p); return Promise.resolve({ waypoints: [] }); },
      applyAdjust: () => ({ ok: true }),
      $: id => (id === 'autoRefine' ? { checked: over.auto !== false } : { classList: { add() {}, remove() {} } })
    };
    const api = factory(deps);
    api.maybeRefine(result);
    return { calls, api };
  }
  // 1) fallback + auto on → 触发修理（callGemini 被叫，prompt 含替換指示），唔係 bail
  const c1 = run(badResult, {});
  assert.equal(c1.calls.prompts.length, 1, 'fallback 要触发自動修理，唔可以 bail');
  assert.ok(c1.calls.prompts[0].includes('貼唔到山徑') && c1.calls.prompts[0].includes('替換'), '修理 prompt 要点名出事路段＋叫替換');
  assert.ok(c1.calls.status.some(s => s[0] === 'info' && s[1].includes('替換離網')), '狀態要講明替換離網 CP');
  // 2) fallback + auto off → 誠實標不合格，唔修理
  const c2 = run(badResult, { auto: false });
  assert.equal(c2.calls.prompts.length, 0);
  assert.ok(c2.calls.status[0][0] === 'bad' && c2.calls.status[0][1].includes('不合格'), 'auto-off + fallback 要標不合格');
  // 3) fallback + 到上限 → 標不合格／不可用
  const c3 = run(badResult, { round: 3, cap: 3 });
  assert.equal(c3.calls.prompts.length, 0);
  assert.ok(c3.calls.status[0][0] === 'bad' && c3.calls.status[0][1].includes('不可用'), '到上限仍 fallback 要標不可用');
  // 4) 全貼路 + 達標 → ok，唔修理
  const c4 = run(goodResult, {});
  assert.equal(c4.calls.prompts.length, 0);
  assert.ok(c4.calls.status[0][0] === 'ok' && c4.calls.status[0][1].includes('全部路段貼上山徑'), '全貼路達標要 ok');
  // 5) resultSummary 要帶出事路段＋距離被低估警告
  const api = factory({ pendingPlan: {}, stopRefine: false, currentNamePlan: {}, notes: () => '', fixedLabels: [], originalRequest: '', refineRound: 0, setStatus: () => {}, setConn: () => {}, refineCap: () => 3, callGemini: () => Promise.resolve({}), applyAdjust: () => ({ ok: true }), $: () => ({ checked: true, classList: { add() {}, remove() {} } }) });
  const sum = api.resultSummary(badResult);
  assert.ok(sum.includes('貼唔到山徑') && sum.includes('北潭涌→萬宜水庫西壩') && sum.includes('低估'), 'resultSummary 要帶 fallback 警告＋路段');
});

test('Phase 3.9：確定性清理（autoClean）＋回頭路偵測（detectBacktrack）＋環線守則；bridge 帶 leg geometry', () => {
  assert.ok(html.includes('function autoClean('), '要有確定性清理 autoClean');
  assert.ok(html.includes('function detectBacktrack('), '要有回頭路偵測');
  assert.ok(html.includes('MAX_CLEAN_DROPS'), '清理要有次数上限');
  assert.ok(html.includes('if(autoClean(d.result)) return;'), 'route:result 要先做確定性清理');
  assert.ok(html.includes('backFail'), 'maybeRefine 要把回頭路纳入觸發');
  assert.ok(!html.includes('去程同回程行唔同山徑'), '3.11：環線解釋句已刪（起==終 AI 自己識係環線，唔使教）');
  assert.ok(html.includes('原路來回'), 'prompt 要禁止原路來回');
  assert.ok(html.includes('.geometry'), 'Canvas 要用 leg geometry 偵測');
});

test('Phase 3.9 autoClean／detectBacktrack 行為：spur／fallback 移除離網 CP、固定點唔移除、到上限停止', () => {
  const slice = html.slice(html.indexOf('const NEAR_M=25'), html.indexOf('function maybeRefine(result){'));
  const factory = new Function('deps',
    'const MAX_CLEAN_DROPS=6; let pendingPlan=deps.pendingPlan, currentNamePlan=deps.currentNamePlan; const {startRoute,setStatus}=deps; let cleanDrops=deps.cleanDrops||0; let cleanRemoved=deps.cleanRemoved||new Set();'
    + slice + ';return {autoClean,detectBacktrack,getDrops:()=>cleanDrops,getPlan:()=>pendingPlan,getRemoved:()=>cleanRemoved};');
  const gOut = [[22.40, 114.30], [22.41, 114.31], [22.42, 114.32]];
  const gBack = [...gOut].reverse();
  const gPerp1 = [[22.40, 114.30], [22.41, 114.30]];
  const gPerp2 = [[22.41, 114.30], [22.41, 114.31]];
  const spurRes = { legs: [{ snapped: true, from: { id: 'start', label: 'A' }, to: { id: 'cpB', label: 'B' }, geometry: gOut }, { snapped: true, from: { id: 'cpB', label: 'B' }, to: { id: 'finish', label: 'C' }, geometry: gBack }] };
  const cleanRes = { legs: [{ snapped: true, from: { id: 'start' }, to: { id: 'cpB' }, geometry: gPerp1 }, { snapped: true, from: { id: 'cpB' }, to: { id: 'finish' }, geometry: gPerp2 }] };
  function mk(over) {
    const routed = [];
    const deps = Object.assign({
      pendingPlan: { start: { id: 'start' }, waypoints: [{ id: 'cpB', role: 'cp', label: 'B' }, { id: 'finish', role: 'finish', label: 'C' }] },
      currentNamePlan: { waypoints: [{ id: 'cpB', role: 'cp' }, { id: 'finish', role: 'finish' }] },
      startRoute: p => routed.push(p), setStatus: () => {}, cleanDrops: 0
    }, over);
    return { api: factory(deps), routed };
  }
  const t1 = mk();
  assert.equal(t1.api.detectBacktrack(spurRes).length, 1, 'spur 原路來回要偵測到 1 對重疊');
  assert.equal(t1.api.detectBacktrack(cleanRes).length, 0, '正常環線唔好誤報');
  assert.equal(t1.api.autoClean(spurRes), true, 'spur 要触发清理');
  assert.deepEqual(t1.routed[0].waypoints.map(w => w.id), ['finish'], '要移除掘頭 spur CP');
  assert.equal(t1.api.getDrops(), 1);
  const t2 = mk({ pendingPlan: { start: { id: 'start' }, waypoints: [{ id: 'cpX', role: 'cp', label: 'X' }, { id: 'finish', role: 'finish', label: 'C' }] }, currentNamePlan: { waypoints: [{ id: 'cpX', role: 'cp' }, { id: 'finish', role: 'finish' }] } });
  const fbRes = { legs: [{ snapped: false, from: { id: 'start', label: 'A' }, to: { id: 'cpX', label: 'X' }, geometry: [] }, { snapped: true, from: { id: 'cpX' }, to: { id: 'finish' }, geometry: gPerp2 }] };
  assert.equal(t2.api.autoClean(fbRes), true, 'fallback 要触发清理');
  assert.deepEqual(t2.routed[0].waypoints.map(w => w.id), ['finish'], '要移除離網 CP，保證地圖無穿海直線');
  const t3 = mk({ pendingPlan: { start: { id: 'start' }, waypoints: [{ id: 'finish', role: 'finish' }] }, currentNamePlan: { waypoints: [{ id: 'finish', role: 'finish' }] } });
  const fixedRes = { legs: [{ snapped: false, from: { id: 'start' }, to: { id: 'finish' }, geometry: [] }] };
  assert.equal(t3.api.autoClean(fixedRes), false, '兩端皆固定點唔可以確定性移除');
  const t4 = mk({ cleanDrops: 6 });
  assert.equal(t4.api.autoClean(spurRes), false, '到清理上限要停止');
});

test('Phase 3.10：拆鎖（只鎖用戶填咗）＋放寬（唔迫揀名單）＋移除北潭涌 priming', () => {
  // 拆鎖：唔再用 skeleton overwrite 把 AI 揀嘅點當用戶固定點
  assert.ok(!html.includes('fixedLabels=sk.fixedLabels'), '唔可以再 overwrite fixedLabels 做全計劃骨架（會鎖死 AI 揀嘅起終點）');
  assert.ok(html.includes('fixedLabels=uf; fixedCamps=uc;'), 'fixed 只保留用戶實際填咗嘅點');
  assert.ok(html.includes('用戶「明確填咗」'), 'prompt 要講明只鎖用戶明確填咗嘅點');
  assert.ok(html.includes('用戶留空（由你揀）嘅點，你調整時可以自由改'), 'AI 揀（留空）嘅點要可以自由改');
  // 放寬：移除起終點／CP 嘅官方名單 forcing
  assert.ok(!html.includes('可以用官方地名（'), '唔再迫起終點／CP 跟官方地名名單');
  assert.ok(html.includes('你係遠足路線專家'), 'prompt 要當 AI 係專家、自由揀');
  assert.ok(html.includes('唔使跟名單'), '要明言唔使跟名單');
  // 移除北潭涌 priming＋冇預設
  assert.ok(!html.includes('例如：北潭涌'), 'placeholder 唔再 prime 北潭涌');
  assert.ok(html.includes('唔好預設北潭涌'), '要明言唔好預設北潭涌');
  // 安全保留：過夜營地仍 AFCD 官方
  assert.ok(html.includes('過夜必須係 AFCD 官方營地'), '營地安全硬要求保留');
  assert.ok(html.includes('嚴禁用營地做畫路 CP'), '營地唔做畫路 CP 保留');
});

test('Phase 3.10 checkFixed 語義：fixed 只係用戶點；用戶留空（fixed=[]）時 AI 改起點唔會誤停', () => {
  const src = html.slice(html.indexOf('function checkFixed('), html.indexOf('const apiKey='));
  const factory = new Function('deps', 'let fixedLabels=deps.fixedLabels, fixedCamps=deps.fixedCamps; const findPlace=deps.findPlace;' + src + ';return checkFixed;');
  const norm = l => ({ name: String(l || '').trim() }); // stub：名即 canonical
  const checkFixed = factory({ fixedLabels: [], fixedCamps: [], findPlace: norm });
  const np = { start: { label: '大帽山' }, waypoints: [{ label: '青山', role: 'cp' }, { label: '屯門', role: 'finish' }] };
  assert.equal(checkFixed(np), null, '用戶留空（fixed=[]）→ AI 任何起終點都唔算改動用戶點');
  const checkFixed2 = factory({ fixedLabels: ['北潭涌'], fixedCamps: [], findPlace: norm });
  const np2 = { start: { label: '大帽山' }, waypoints: [{ label: '屯門', role: 'finish' }] };
  assert.ok(checkFixed2(np2), '用戶明確填咗北潭涌 → AI 改咗就要報錯');
  const checkFixed3 = factory({ fixedLabels: ['北潭涌'], fixedCamps: [], findPlace: norm });
  const np3 = { start: { label: '北潭涌' }, waypoints: [{ label: '大帽山', role: 'cp' }, { label: '北潭涌', role: 'finish' }] };
  assert.equal(checkFixed3(np3), null, '用戶起點保留＋AI 自由加中途點 → 通過');
});

test('Phase 3.11：版號可見＋導師 persona＋起終點交通可達＋繞路靠 CP＋刪環線廢句', () => {
  // 版號：title 同 header badge 一致，一眼知係咪最新
  const t = html.match(/<title>[^<]*v(\d+\.\d+)[^<]*<\/title>/);
  const b = html.match(/<span class="ver">v(\d+\.\d+)<\/span>/);
  assert.ok(t, 'title 要有版號');
  assert.ok(b, 'header 要有版號 badge');
  assert.equal(t[1], b[1], 'title 同 badge 版號要一致');
  assert.equal(t[1], '3.13', '而家係 v3.13');
  // 導師 persona
  assert.ok(html.includes('資深遠足導師／領隊'), 'GEN 要以資深遠足導師／領隊身份策劃');
  assert.ok(html.includes('切實可行'), '要強調切實可行');
  // 起終點可行性
  assert.ok(html.includes('交通可達'), '起終點要交通可達');
  assert.ok(html.includes('山頂／三角網測站只可以做中途 CP，唔好做起終點'), '山頂／測站唔好做起終點');
  // 繞路靠 CP
  assert.ok(html.includes('最直接山徑'), '要講明引擎行最直接山徑');
  assert.ok(html.includes('加中途 CP 引導繞路'), '要教 AI 用 CP 引導繞路');
  // 環線廢句全删（prompt＋refine 指示＋狀態訊息）
  assert.ok(!html.includes('請改做環線'), 'refine 指示唔再迫改環線');
  assert.ok(!html.includes('改做環線中'), '狀態訊息唔再講環線');
  assert.ok(!html.includes('手動改 CP 做環線'), 'cap 警告唔再講環線');
  // 有效性約束保留
  assert.ok(html.includes('唔好原路來回／掘頭 spur'), 'no-backtrack／no-spur 保留');
  assert.ok(html.includes('請改行唔同山徑嘅路徑'), 'backtrack 修理指示保留（唔同山徑，唔係迫環線）');
});

test('Phase 3.12：blacklist 被移除點（嚴禁加返）＋跨海安全移除唔设 cap＋reset 語義', () => {
  // blacklist prompt（auto-refine＋manual 兩處）
  assert.ok(html.includes('已被系统確定性移除（離網／跨海／掘頭），嚴禁再加返'), 'refine prompt 要有 blacklist 嚴禁加返');
  assert.equal((html.match(/嚴禁再加返/g) || []).length, 2, 'auto-refine 同 manual 兩處都要有 blacklist');
  assert.ok(html.includes('let cleanRemoved=new Set();'), '要有 cleanRemoved 聲明');
  // reset 語義：3 個新計劃入口 reset；applyAdjust（每輪 refine）唔 reset（blacklist 要跨回合保留）
  assert.equal((html.match(/cleanRemoved=new Set\(\);/g) || []).length, 4, '1 聲明＋3 入口 reset＝4');
  assert.ok(html.includes('currentNamePlan=np; pendingPlan=plan; cleanDrops=0;'), 'applyAdjust 只 reset cleanDrops');
  assert.ok(!html.includes('currentNamePlan=np; pendingPlan=plan; cleanDrops=0; cleanRemoved'), 'applyAdjust 唔可以 reset cleanRemoved（否則 blacklist 每輪失效）');
  // 跨海安全移除唔设 cap
  assert.ok(html.includes('if(cleanDrops>=MAX_CLEAN_DROPS && safety.size===0) return false;'), 'cap 只擋 spur 優化；離網／跨海 safety 移除永遠執行');
  assert.ok(html.includes('cleanRemoved.add(w.label)'), 'autoClean 要記低被移除 CP 名');
});

test('Phase 3.12 autoClean 行為：記低被移除名＋到 cap 仍移除跨海 CP（safety bypass）', () => {
  const slice = html.slice(html.indexOf('const NEAR_M=25'), html.indexOf('function maybeRefine(result){'));
  const factory = new Function('deps',
    'const MAX_CLEAN_DROPS=6; let pendingPlan=deps.pendingPlan, currentNamePlan=deps.currentNamePlan; const {startRoute,setStatus}=deps; let cleanDrops=deps.cleanDrops||0; let cleanRemoved=deps.cleanRemoved||new Set();'
    + slice + ';return {autoClean,getRemoved:()=>cleanRemoved,getDrops:()=>cleanDrops};');
  const gPerp2 = [[22.41, 114.30], [22.41, 114.31]];
  function mk(over) {
    const routed = [];
    const deps = Object.assign({
      pendingPlan: { start: { id: 'start' }, waypoints: [{ id: 'cpX', role: 'cp', label: '蛋家灣' }, { id: 'finish', role: 'finish', label: 'C' }] },
      currentNamePlan: { waypoints: [{ id: 'cpX', role: 'cp', label: '蛋家灣' }, { id: 'finish', role: 'finish' }] },
      startRoute: p => routed.push(p), setStatus: () => {}, cleanDrops: 0
    }, over);
    return { api: factory(deps), routed };
  }
  const fbRes = { legs: [{ snapped: false, from: { id: 'start', label: 'A' }, to: { id: 'cpX', label: '蛋家灣' }, geometry: [] }, { snapped: true, from: { id: 'cpX' }, to: { id: 'finish' }, geometry: gPerp2 }] };
  // 記低被移除名
  const t1 = mk();
  assert.equal(t1.api.autoClean(fbRes), true, '跨海 fallback 要触发清理');
  assert.ok(t1.api.getRemoved().has('蛋家灣'), 'autoClean 要記低被移除嘅蛋家灣');
  assert.deepEqual(t1.routed[0].waypoints.map(w => w.id), ['finish'], '要移除跨海 CP');
  // 到 cap（cleanDrops=6）仍然移除跨海 CP（safety bypass）——保證地圖冇游水線
  const t2 = mk({ cleanDrops: 6 });
  assert.equal(t2.api.autoClean(fbRes), true, '到 cap 仍要移除跨海 CP（安全嘢唔受 cap 限）');
  assert.ok(t2.api.getRemoved().has('蛋家灣'), 'cap 下移除都要記低名');
  // spur-only（全部 snapped）到 cap 就要停（cap 只限優化移除）
  const gOut = [[22.40, 114.30], [22.41, 114.31], [22.42, 114.32]];
  const spurRes = { legs: [{ snapped: true, from: { id: 'start' }, to: { id: 'cpX', label: '蛋家灣' }, geometry: gOut }, { snapped: true, from: { id: 'cpX' }, to: { id: 'finish' }, geometry: [...gOut].reverse() }] };
  const t3 = mk({ cleanDrops: 6 });
  assert.equal(t3.api.autoClean(spurRes), false, 'spur-only 到 cap 要停（優化移除受 cap 限）');
});

test('Phase 3.13：refine cap 放寬 0–12＋busy 防止狂按＋status 置頂＋DP 編號後備座標', () => {
  // cap 放寬
  assert.ok(html.includes('id="fRefineCap" value="6" min="0" max="12"'), 'cap input 要 0–12，預設 6');
  assert.ok(html.includes('Math.max(0,Math.min(12,v))'), 'refineCap clamp 要去到 12');
  assert.ok(html.includes('（0–12）'), 'label 要寫 0–12');
  // busy 守衛
  assert.ok(html.includes('function refreshBusy()'), '要有 refreshBusy');
  assert.ok(html.includes('aiBusy=true; refreshBusy();'), 'callGemini 要設 aiBusy');
  assert.ok(html.includes('finally{ aiBusy=false; refreshBusy(); }'), 'callGemini 完成要解除 busy');
  assert.ok(html.includes('pendingId=uuid(); refreshBusy();'), '計路開始要 busy');
  assert.ok(html.includes("['btnPlan','btnDemo','btnNotesAdjust','btnConfirm','btnAddDay']"), 'busy 要禁用所有動作按鈕');
  // status 置頂＋sticky
  assert.ok(html.includes('#status{position:sticky;top:0;z-index:80'), 'status 要 sticky 置頂');
  assert.ok(html.indexOf('id="status"') < html.indexOf('class="inputbar"'), 'status 元素要喺 inputbar 之上（頂部可見）');
  // DP 編號後備座標
  assert.ok(html.includes('【編號後備座標】'), 'prompt 要叫 AI 為編號附後備座標');
  assert.ok(html.includes('若編號未收錄就用你嘅真實座標'), '未收錄編號用 AI 座標後備');
});

test('Phase 3.13 detectBacktrack 單向包含：出段繼續行好遠（min 稀釋）仍捉到掘頭 spur', () => {
  const slice = html.slice(html.indexOf('const NEAR_M=25'), html.indexOf('function maybeRefine(result){'));
  const factory = new Function('deps',
    'const MAX_CLEAN_DROPS=6; let pendingPlan=deps.pendingPlan, currentNamePlan=deps.currentNamePlan; const {startRoute,setStatus}=deps; let cleanDrops=deps.cleanDrops||0; let cleanRemoved=deps.cleanRemoved||new Set();'
    + slice + ';return {autoClean,detectBacktrack,mutualOverlap,overlapFrac};');
  const routed = [];
  const deps = {
    pendingPlan: { start: { id: 'start' }, waypoints: [{ id: 'cpTip', role: 'cp', label: '榕樹澳' }, { id: 'finish', role: 'finish', label: 'C' }] },
    currentNamePlan: { waypoints: [{ id: 'cpTip', role: 'cp', label: '榕樹澳' }, { id: 'finish', role: 'finish' }] },
    startRoute: p => routed.push(p), setStatus: () => {}, cleanDrops: 0
  };
  const api = factory(deps);
  // 入 tip 短廊；出 tip 原路折返之後繼續行好遠 → mutualOverlap(min) 被稀釋 < 0.6
  const gIn = [[22.40, 114.30], [22.41, 114.30], [22.42, 114.30]];
  const gOut = [...gIn].reverse().concat([[22.41, 114.32], [22.41, 114.34], [22.41, 114.36], [22.41, 114.38]]);
  const res = { legs: [
    { snapped: true, from: { id: 'start', label: 'A' }, to: { id: 'cpTip', label: '榕樹澳' }, geometry: gIn },
    { snapped: true, from: { id: 'cpTip', label: '榕樹澳' }, to: { id: 'finish', label: 'C' }, geometry: gOut }
  ] };
  assert.ok(api.mutualOverlap(res.legs[0], res.legs[1]) <= 0.6, '呢個 case mutualOverlap(min) 應該被稀釋（舊偵測會漏）');
  assert.ok(api.overlapFrac(gIn, gOut) > 0.6, '入 tip 段應該被出段包含');
  assert.equal(api.detectBacktrack(res).length, 1, '單向包含要捉到掘頭 spur（榕樹澳）');
  assert.equal(api.autoClean(res), true, 'spur 要触发清理');
  assert.deepEqual(routed[0].waypoints.map(w => w.id), ['finish'], '要移除掘頭 tip CP');
});
