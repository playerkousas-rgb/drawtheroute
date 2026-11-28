/**
 * embedBridge.ts — DrawTheRoute 端嘅 Canvas embed bridge（Option A）
 *
 * 只喺 embed mode（iframe + 已驗證 SCF parentOrigin）啟動。
 * 接駁真實 route engine（useRouteManager.planRoute → buildSegment → BRouter），
 * 回傳真實距離／爬升／時間／fallback warnings／criteria。
 *
 * 安全：
 *  - 一律用精確 parentOrigin 做 targetOrigin（嚴禁 '*'）。
 *  - 接收端核對 event.origin === parentOrigin 且 event.source === window.parent。
 *  - handshake（canvas:init）完成前先至接受 route:plan。
 *  - 單一同時請求、逾時、取消、requestId 去重。
 *  - postMessage 唔係安全邊界；真正防 unauthorized embedding 靠 CSP frame-ancestors。
 */
import { useEffect, useRef } from 'react';
import { LatLng, NaismithSettings } from '../types';
import { analyzeRoute, naismithMinutes } from '../services/routeAnalysis';
import {
  CHANNEL, PROTOCOL_VERSION, BRIDGE_VERSION, LIMITS, ERROR_CODES,
  parseEnvelope, validatePlan, isAllowedParentOrigin,
  NormalizedPlan, RouteResult, LegResult, DayResult, BridgeWarning, CriterionResult, ErrorCode,
  DetourBaseLeg, DetourCandidate, DetourOption,
} from './contract';

export interface EmbedConfig { parentOrigin: string; }

declare global {
  interface Window { __DTR_EMBED__?: EmbedConfig | null; }
}

export interface BridgeDeps {
  planRoute: (points: Array<LatLng & { label?: string }>) => Promise<{
    segments: import('../types').RouteSegment[];
    legMeta: Array<{ snapped: boolean; snappedLegs: number; totalLegs: number }>;
  }>;
  naismith: NaismithSettings;
  appVersion: string;
  /** 可選：截取目前路線地圖（含 CP 地名）做 PNG dataURL，回俾 Canvas 顯示／下載 */
  captureMap?: () => Promise<{ dataUrl: string; width: number; height: number }>;
}

export function readEmbedConfig(): EmbedConfig | null {
  const cfg = window.__DTR_EMBED__;
  if (!cfg || typeof cfg.parentOrigin !== 'string') return null;
  if (!isAllowedParentOrigin(cfg.parentOrigin, window.location.origin)) return null;
  return cfg;
}

export function useEmbedBridge(deps: BridgeDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const cfg = readEmbedConfig();
    if (!cfg) return;                       // 非 embed mode → 完全唔啟動，頂層行為不變
    const parentOrigin = cfg.parentOrigin;

    let handshakeDone = false;
    let busy = false;
    let snapshotBusy = false;
    let currentRequestId: string | null = null;
    let cancelled = false;
    let timeoutTimer: number | null = null;
    const processed = new Set<string>();
    const parent = window.parent;

    const send = (type: string, payload: Record<string, unknown>, requestId?: string) => {
      // ★ 精確 targetOrigin，嚴禁 '*'
      parent.postMessage({ channel: CHANNEL, version: PROTOCOL_VERSION, type, requestId, ...payload }, parentOrigin);
    };
    const sendError = (requestId: string | undefined, code: ErrorCode, message: string, retryable: boolean) => {
      send('route:error', { code, message, retryable }, requestId);
    };

    const clearTimer = () => { if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timeoutTimer = null; } };

    const buildResult = (plan: NormalizedPlan, segments: import('../types').RouteSegment[], legMeta: Array<{ snapped: boolean }>): RouteResult => {
      const { naismith, appVersion } = depsRef.current;
      const { stats, analyzedSegments } = analyzeRoute(segments, naismith);
      const warnings: BridgeWarning[] = [];
      const legs: LegResult[] = [];
      const dayMap = new Map<number, DayResult>();
      let fallbackUsed = false;
      // 路段幾何取樣（[lat,lon]，最多 ~240 點）俾 Canvas 偵測回頭路／原路來回
      const sampleGeom = (pts: Array<{ lat: number; lng: number }>): Array<[number, number]> => {
        const n = pts.length;
        if (!n) return [];
        const step = Math.max(1, Math.ceil(n / 240));
        const out: Array<[number, number]> = [];
        for (let i = 0; i < n; i += step) out.push([+pts[i].lat.toFixed(5), +pts[i].lng.toFixed(5)]);
        const last: [number, number] = [+pts[n - 1].lat.toFixed(5), +pts[n - 1].lng.toFixed(5)];
        const tail = out[out.length - 1];
        if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
        return out;
      };

      for (let i = 0; i < analyzedSegments.length; i++) {
        const seg = analyzedSegments[i];
        const meta = legMeta[i];
        const snapped = !!meta?.snapped;
        if (!snapped) {
          fallbackUsed = true;
          warnings.push({
            code: 'FALLBACK_STRAIGHT',
            message: `第 ${i + 1} 段（${plan.points[i].label} → ${plan.points[i + 1].label}）未能貼上山徑，用咗直線＋SRTM 備援；數字唔可靠，不可作導航／正式行程表。`,
            legIndex: i,
          });
        }
        const distanceM = Math.round(seg.distance * 1000);
        const minutes = naismithMinutes(seg.distance, seg.ascent, seg.descent, naismith);
        const day = plan.legDays[i] ?? 1;
        legs.push({
          index: i, day,
          from: { id: plan.points[i].id, label: plan.points[i].label, lat: plan.points[i].lat, lon: plan.points[i].lon },
          to: { id: plan.points[i + 1].id, label: plan.points[i + 1].label, lat: plan.points[i + 1].lat, lon: plan.points[i + 1].lon },
          distanceM, ascentM: seg.ascent, descentM: seg.descent,
          estimatedMovingMinutes: Math.round(minutes),
          snapped, mode: seg.mode,
          geometry: sampleGeom(seg.points || []),
        });
        if (!dayMap.has(day)) dayMap.set(day, { day, distanceM: 0, ascentM: 0, descentM: 0, estimatedMovingMinutes: 0, legIndexes: [] });
        const d = dayMap.get(day)!;
        d.distanceM += distanceM; d.ascentM += seg.ascent; d.descentM += seg.descent;
        d.estimatedMovingMinutes += Math.round(minutes); d.legIndexes.push(i);
      }

      const days = [...dayMap.values()].sort((a, b) => a.day - b.day);
      const totalDistanceM = Math.round(stats.totalDistance * 1000);

      // criteria：只比對使用者明確訂嘅門檻；冇就 unknown。fallback 不可 pass。
      const criteria: CriterionResult[] = [];
      criteria.push({
        id: 'all_legs_snapped', label: '所有路段成功貼上山徑',
        status: fallbackUsed ? 'fail' : 'pass',
        detail: fallbackUsed ? '有路段用直線 fallback，未完成山徑路由。' : '全部路段由 BRouter hiking-mountain 貼路。',
      });
      const numStatus = (ok: boolean): 'pass' | 'fail' | 'unknown' => fallbackUsed ? 'unknown' : (ok ? 'pass' : 'fail');

      if (plan.targetTotalKm != null) {
        const tol = plan.constraints.targetDistanceToleranceKm;
        const totalKm = totalDistanceM / 1000;
        if (tol == null) {
          criteria.push({ id: 'target_total_km', label: `總距離目標 ${plan.targetTotalKm} km`, status: 'unknown', detail: `實際 ${totalKm.toFixed(2)} km；未定義容差，待領隊確認。` });
        } else {
          const ok = Math.abs(totalKm - plan.targetTotalKm) <= tol;
          criteria.push({ id: 'target_total_km', label: `總距離 ${plan.targetTotalKm} ± ${tol} km`, status: numStatus(ok), detail: `實際 ${totalKm.toFixed(2)} km。` });
        }
      }
      if (plan.constraints.maxMovingMinutesPerDay != null) {
        const lim = plan.constraints.maxMovingMinutesPerDay;
        const worst = days.reduce((m, d) => Math.max(m, d.estimatedMovingMinutes), 0);
        criteria.push({ id: 'max_moving_min_per_day', label: `每日行走 ≤ ${lim} 分鐘`, status: numStatus(worst <= lim), detail: `最多一日 ${worst} 分鐘。` });
      }
      if (plan.constraints.maxAscentMPerDay != null) {
        const lim = plan.constraints.maxAscentMPerDay;
        const worst = days.reduce((m, d) => Math.max(m, d.ascentM), 0);
        criteria.push({ id: 'max_ascent_per_day', label: `每日爬升 ≤ ${lim} m`, status: numStatus(worst <= lim), detail: `最多一日 ${worst} m。` });
      }
      if (fallbackUsed) {
        warnings.push({ code: 'HUMAN_REVIEW_REQUIRED', message: '有 fallback 路段；整體結果只係候選預覽，必須人手核實，不可宣稱為安全／已批准。' });
      }

      return {
        source: 'drawtheroute', engineVersion: appVersion, bridgeVersion: BRIDGE_VERSION,
        computedAt: new Date().toISOString(),
        total: { distanceM: totalDistanceM, ascentM: stats.totalAscent, descentM: stats.totalDescent, estimatedMovingMinutes: Math.round(stats.estimatedTime) },
        days, legs, warnings, criteria, fallbackUsed, humanReviewRequired: true,
      };
    };

    const handlePlan = async (requestId: string | undefined, planRaw: unknown) => {
      if (!handshakeDone) { sendError(requestId, ERROR_CODES.NOT_READY, '未完成 canvas:init 握手。', false); return; }
      if (!requestId || requestId.length > LIMITS.MAX_REQUEST_ID_LEN) { sendError(requestId, ERROR_CODES.BAD_MESSAGE, 'requestId 無效。', false); return; }
      if (processed.has(requestId)) { sendError(requestId, ERROR_CODES.DUPLICATE, 'requestId 重複。', false); return; }
      if (busy) { sendError(requestId, ERROR_CODES.BUSY, '已有規劃進行中，請等完成或取消。', true); return; }

      const v = validatePlan(planRaw);
      if (!v.ok) { sendError(requestId, ERROR_CODES.INVALID_PLAN, 'plan 驗證失敗：' + v.errors.join('；'), false); return; }

      processed.add(requestId);
      busy = true; currentRequestId = requestId; cancelled = false;
      clearTimer();
      timeoutTimer = window.setTimeout(() => {
        if (currentRequestId === requestId) { cancelled = true; sendError(requestId, ERROR_CODES.TIMEOUT, '規劃逾時。', true); }
      }, LIMITS.REQUEST_TIMEOUT_MS);

      try {
        const points = v.plan.points.map(p => ({ lat: p.lat, lng: p.lon, label: p.label }));
        const { segments, legMeta } = await depsRef.current.planRoute(points);
        if (cancelled || currentRequestId !== requestId) return;   // 已取消／逾時 → 唔回舊結果
        const result = buildResult(v.plan, segments, legMeta);
        send('route:result', { result }, requestId);
      } catch (e) {
        if (cancelled || currentRequestId !== requestId) return;
        sendError(requestId, ERROR_CODES.ENGINE_ERROR, e instanceof Error ? e.message : '路線計算失敗。', true);
      } finally {
        if (currentRequestId === requestId) { busy = false; currentRequestId = null; clearTimer(); }
      }
    };

    /* Phase 3.17：route:options —— DTR 淨係計數：每個候選插入骨架後真實加幾多 km／爬升＋貼路與否。
       AI 喺 Canvas 只喺返嚟嘅清單度揀，唔使估座標／距離。 */
    const handleOptions = async (requestId: string | undefined, payload: Record<string, unknown>) => {
      if (!handshakeDone) { sendError(requestId, ERROR_CODES.NOT_READY, '未完成 canvas:init 握手。', false); return; }
      if (!requestId || requestId.length > LIMITS.MAX_REQUEST_ID_LEN) { sendError(requestId, ERROR_CODES.BAD_MESSAGE, 'requestId 無效。', false); return; }
      if (processed.has(requestId)) { sendError(requestId, ERROR_CODES.DUPLICATE, 'requestId 重複。', false); return; }
      if (busy) { sendError(requestId, ERROR_CODES.BUSY, '已有規劃進行中，請等完成或取消。', true); return; }
      const baseLegs = (Array.isArray(payload.baseLegs) ? payload.baseLegs : []) as DetourBaseLeg[];
      const rawCands = (Array.isArray(payload.candidates) ? payload.candidates : []) as DetourCandidate[];
      const cands = rawCands.slice(0, LIMITS.MAX_OPTION_CANDIDATES).filter(c =>
        c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Number.isInteger(c.legIndex) && !!baseLegs[c.legIndex]);
      processed.add(requestId);
      busy = true; currentRequestId = requestId; cancelled = false;
      clearTimer();
      timeoutTimer = window.setTimeout(() => {
        if (currentRequestId === requestId) { cancelled = true; sendError(requestId, ERROR_CODES.TIMEOUT, 'options 逾時。', true); }
      }, LIMITS.REQUEST_TIMEOUT_MS);
      try {
        const options: DetourOption[] = [];
        // 並行（concurrency 4）計候選——sequential 12 個 BRouter 呼叫會慢到似卡死；個別失敗唔 abort 全部
        let idx = 0;
        const worker = async () => {
          while (idx < cands.length) {
            if (cancelled || currentRequestId !== requestId) return;
            const c = cands[idx++];
            try {
              const bl = baseLegs[c.legIndex];
              const pts = [
                { lat: bl.from.lat, lng: bl.from.lon, label: bl.from.label },
                { lat: c.lat, lng: c.lon, label: c.label },
                { lat: bl.to.lat, lng: bl.to.lon, label: bl.to.label },
              ];
              const { segments, legMeta } = await depsRef.current.planRoute(pts);
              const { stats } = analyzeRoute(segments, depsRef.current.naismith);
              const snapped = legMeta.every(m => !!m && m.snapped);
              const addKm = (stats.totalDistance * 1000 - bl.distanceM) / 1000;
              const addAscentM = Math.round(stats.totalAscent - (bl.ascentM || 0));
              options.push({ id: c.id, label: c.label, lat: c.lat, lon: c.lon, legIndex: c.legIndex, addKm: +addKm.toFixed(2), addAscentM, snapped });
            } catch { /* 单个候選計失敗 → 跳過，唔拖死成張清單 */ }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, cands.length) }, () => worker()));
        if (cancelled || currentRequestId !== requestId) return;
        send('route:options-result', { options }, requestId);
      } catch (e) {
        if (cancelled || currentRequestId !== requestId) return;
        sendError(requestId, ERROR_CODES.ENGINE_ERROR, e instanceof Error ? e.message : 'options 計算失敗。', true);
      } finally {
        if (currentRequestId === requestId) { busy = false; currentRequestId = null; clearTimer(); }
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== parentOrigin) return;          // 錯誤 origin → 靜默拒絕
      if (e.source !== parent) return;                // 錯誤 source → 拒絕
      const env = parseEnvelope(e.data);
      if (!env) return;
      if (env.version !== PROTOCOL_VERSION) { sendError(env.requestId, ERROR_CODES.UNSUPPORTED_VERSION, `不支援協定版本 ${env.version}。`, false); return; }

      if (env.type === 'canvas:init') {
        handshakeDone = true;
        send('canvas:init-ack', { bridgeVersion: BRIDGE_VERSION, schemaVersion: PROTOCOL_VERSION }, env.requestId);
        return;
      }
      if (env.type === 'route:plan') {
        const planRaw = (e.data as Record<string, unknown>).plan;
        void handlePlan(env.requestId, planRaw);
        return;
      }
      if (env.type === 'route:options') {
        void handleOptions(env.requestId, e.data as Record<string, unknown>);
        return;
      }
      if (env.type === 'route:cancel') {
        if (env.requestId && env.requestId === currentRequestId) { cancelled = true; sendError(env.requestId, ERROR_CODES.CANCELLED, '已取消。', false); }
        return;
      }
      if (env.type === 'map:snapshot') {
        if (!handshakeDone) { send('map:snapshot-error', { message: '未完成握手。' }, env.requestId); return; }
        const cap = depsRef.current.captureMap;
        if (!cap) { send('map:snapshot-error', { message: '呢個版本未支援地圖截圖。' }, env.requestId); return; }
        if (snapshotBusy) { send('map:snapshot-error', { message: '截圖進行中，請稍候。' }, env.requestId); return; }
        snapshotBusy = true;
        cap().then(img => {
          send('map:snapshot-result', { image: img.dataUrl, width: img.width, height: img.height }, env.requestId);
        }).catch(err => {
          send('map:snapshot-error', { message: err instanceof Error ? err.message : '截圖失敗。' }, env.requestId);
        }).finally(() => { snapshotBusy = false; });
        return;
      }
    };

    window.addEventListener('message', onMessage);
    // handshake：通知 parent 我哋 ready（精確 targetOrigin）
    send('drawtheroute:ready', { bridgeVersion: BRIDGE_VERSION, appVersion: depsRef.current.appVersion, schemaVersion: PROTOCOL_VERSION });

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimer();
    };
  }, []);
}
