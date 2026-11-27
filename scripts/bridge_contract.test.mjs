// Embed bridge contract v1 — runtime validator 測試
// 用法: npx tsx --test scripts/bridge_contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL, PROTOCOL_VERSION, LIMITS,
  isScfOrigin, isAllowedParentOrigin, parseEnvelope, validatePlan,
} from '../src/bridge/contract.ts';

const SCF = 'https://69ftaztgixa94dsheiwr20fv59vn9n21atuck72tuujoefgxcr-h1029127910.scf.usercontent.goog';

const goodPlan = () => ({
  days: 3, nights: 2, targetTotalKm: 40,
  start: { label: '北潭涌', lat: 22.4046, lon: 114.3147 },
  waypoints: [
    { id: 'camp1', label: '猴塘溪', lat: 22.42, lon: 114.33, role: 'overnight' },
    { id: 'camp2', label: '大灘', lat: 22.43, lon: 114.34, role: 'overnight' },
    { id: 'finish', label: '北潭涌', lat: 22.4046, lon: 114.3147, role: 'finish' },
  ],
  stages: [
    { day: 1, from: 'start', to: 'camp1' },
    { day: 2, from: 'camp1', to: 'camp2' },
    { day: 3, from: 'camp2', to: 'finish' },
  ],
  constraints: { maxMovingMinutesPerDay: 480, maxAscentMPerDay: 1000, targetDistanceToleranceKm: 5 },
});

test('isScfOrigin 認得 SCF，拒絕其他', () => {
  assert.equal(isScfOrigin(SCF), true);
  assert.equal(isScfOrigin('https://gemini.google.com'), false);
  assert.equal(isScfOrigin('https://evil.com'), false);
  assert.equal(isScfOrigin('null'), false);
  assert.equal(isScfOrigin('https://scf.usercontent.goog'), false); // 冇 subdomain hash
});

test('isAllowedParentOrigin：生產只認 SCF＋same-origin；dev host 先容許 localhost cross-port', () => {
  assert.equal(isAllowedParentOrigin(SCF, 'https://drawtheroute.vercel.app'), true);
  assert.equal(isAllowedParentOrigin('http://localhost:5173', 'https://drawtheroute.vercel.app'), false);
  assert.equal(isAllowedParentOrigin('https://drawtheroute.vercel.app', 'https://drawtheroute.vercel.app'), true); // same-origin
  assert.equal(isAllowedParentOrigin('http://localhost:5173', 'http://localhost:5173'), true); // same-origin
  assert.equal(isAllowedParentOrigin('http://localhost:5174', 'http://localhost:5173'), true); // dev cross-port
  assert.equal(isAllowedParentOrigin('http://127.0.0.1:5173', 'http://127.0.0.1:5173'), true);
  assert.equal(isAllowedParentOrigin('https://evil.com', 'http://localhost:5173'), false);
  assert.equal(isAllowedParentOrigin('https://5173-x.e2b.app', 'https://5173-x.e2b.app'), true); // preview same-origin
  assert.equal(isAllowedParentOrigin('https://evil.com', 'https://5173-x.e2b.app'), false);
});

test('parseEnvelope：正確格式通過，錯誤拒絕', () => {
  assert.ok(parseEnvelope({ channel: CHANNEL, version: 1, type: 'route:plan', requestId: 'x' }));
  assert.equal(parseEnvelope({ channel: 'other', version: 1, type: 'x' }), null);
  assert.equal(parseEnvelope({ channel: CHANNEL, version: '1', type: 'x' }), null);
  assert.equal(parseEnvelope(null), null);
  assert.equal(parseEnvelope({ channel: CHANNEL, version: 1 }), null);
});

test('validatePlan：合法 plan 正規化', () => {
  const r = validatePlan(goodPlan());
  assert.equal(r.ok, true);
  assert.equal(r.plan.points.length, 4);
  assert.equal(r.plan.points[0].id, 'start');
  assert.deepEqual(r.plan.legDays, [1, 2, 3]);
  assert.equal(r.plan.days, 3);
  assert.equal(r.plan.targetTotalKm, 40);
  assert.equal(r.plan.constraints.maxAscentMPerDay, 1000);
});

test('validatePlan：缺 start／waypoints 空／座標超界 拒絕', () => {
  assert.equal(validatePlan({ waypoints: [{ lat: 22, lon: 114 }] }).ok, false);
  assert.equal(validatePlan({ start: { lat: 22, lon: 114 }, waypoints: [] }).ok, false);
  const bad = goodPlan(); bad.start.lat = 999;
  assert.equal(validatePlan(bad).ok, false);
  const bad2 = goodPlan(); bad2.waypoints[0].lon = -999;
  assert.equal(validatePlan(bad2).ok, false);
});

test('validatePlan：CP 過多／id 重複 拒絕', () => {
  const many = goodPlan();
  many.waypoints = Array.from({ length: LIMITS.MAX_POINTS + 1 }, (_, i) => ({ id: 'w' + i, lat: 22, lon: 114 }));
  assert.equal(validatePlan(many).ok, false);
  const dup = goodPlan(); dup.waypoints[1].id = 'camp1';
  assert.equal(validatePlan(dup).ok, false);
});

test('validatePlan：部分 stages → 缺漏 leg 用 overnight 推斷（唔再拒絕）', () => {
  const p = goodPlan(); p.stages = [{ day: 1, from: 'start', to: 'camp1' }];
  const r = validatePlan(p);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.legDays, [1, 2, 3]);
});

test('validatePlan：AI 加中途點後 stages 唔齊 → 仍按 overnight 分日', () => {
  const p = goodPlan();
  // 喺 camp1 前插入一個中途 cp，stages 仍舊只 covering 舊嘅起訖
  p.waypoints.splice(0, 0, { id: 'mid', label: '嶂上', lat: 22.4285, lon: 114.3098, role: 'cp' });
  const r = validatePlan(p);
  assert.equal(r.ok, true);
  // start→mid→camp1(overnight)→camp2(overnight)→finish = [1,1,2,3]
  assert.deepEqual(r.plan.legDays, [1, 1, 2, 3]);
});

test('validatePlan：冇 stages → overnight 推斷日界', () => {
  const p = goodPlan(); delete p.stages;
  const r = validatePlan(p);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.legDays, [1, 2, 3]);
});

test('validatePlan：日數過多 拒絕', () => {
  const p = goodPlan();
  p.waypoints = Array.from({ length: LIMITS.MAX_DAYS + 1 }, (_, i) => ({ id: 'c' + i, lat: 22, lon: 114, role: 'overnight' }));
  delete p.stages;
  assert.equal(validatePlan(p).ok, false);
});

test('validatePlan：constraints 只接受有效正數', () => {
  const p = goodPlan();
  p.constraints = { maxMovingMinutesPerDay: -5, maxAscentMPerDay: 'abc', targetDistanceToleranceKm: 0 };
  const r = validatePlan(p);
  assert.equal(r.ok, true);
  assert.equal(r.plan.constraints.maxMovingMinutesPerDay, undefined);
  assert.equal(r.plan.constraints.maxAscentMPerDay, undefined);
  assert.equal(r.plan.constraints.targetDistanceToleranceKm, 0);
});
