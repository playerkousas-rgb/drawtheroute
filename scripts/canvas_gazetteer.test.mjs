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

test('AI prompt 禁止輸出座標，必須用地點表', () => {
  assert.ok(html.includes('唔好輸出 lat/lon'), 'prompt 要禁止 AI 輸出座標');
  assert.ok(html.includes('必須從中選擇'), 'prompt 要限制只用地點表');
  assert.ok(!html.includes('用你最接近嘅估計'), '唔可以再叫 AI 估座標');
});

test('有距離回饋循環（最多 3 round）同停止掣', () => {
  assert.ok(html.includes('MAX_REFINE_ROUNDS=3'), '要有 3 round 上限');
  assert.ok(html.includes('maybeRefine'), '要有回饋循環');
  assert.ok(html.includes('btnStopRefine'), '要有停止掣');
});
