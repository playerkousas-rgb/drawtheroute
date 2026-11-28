/**
 * contract.ts — DrawTheRoute × GEMINI Canvas embed bridge 訊息合約 v1
 *
 * 對應計劃 #65 §4。所有訊息必須帶 channel／version／type／requestId。
 * ★ 生產 bridge 嚴禁 targetOrigin:'*'；一律用已驗證嘅精確 parentOrigin。
 * ★ postMessage 唔係安全邊界：真正防 unauthorized embedding 靠 CSP frame-ancestors。
 */

export const CHANNEL = 'scout.drawtheroute';
export const PROTOCOL_VERSION = 1;
export const BRIDGE_VERSION = '1.0.0';

/** 資源限制（計劃 §6.6 DoS 防護） */
export const LIMITS = {
  MAX_POINTS: 24,          // start + waypoints 上限
  MAX_DAYS: 14,
  MAX_REQUEST_ID_LEN: 128,
  REQUEST_TIMEOUT_MS: 180000,   // 整體規劃逾時（BRouter 每段本身有 15–20s timeout）
  HANDSHAKE_TIMEOUT_MS: 30000,
  MAX_CONCURRENT: 1,         // 單一同時 route request
  MAX_OPTION_CANDIDATES: 12, // route:options 每次最多計幾多個繞路候選（DoS 防護）
} as const;

/** 穩定 error code */
export const ERROR_CODES = {
  BAD_ORIGIN: 'BAD_ORIGIN',
  BAD_SOURCE: 'BAD_SOURCE',
  BAD_MESSAGE: 'BAD_MESSAGE',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  NOT_READY: 'NOT_READY',
  INVALID_PLAN: 'INVALID_PLAN',
  BUSY: 'BUSY',
  DUPLICATE: 'DUPLICATE',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  ENGINE_ERROR: 'ENGINE_ERROR',
} as const;
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/* ════════════════════════════════════════════════════════════════
   Origin 驗證
   ════════════════════════════════════════════════════════════════ */

/** Google SafeContentFrame origin（Gemini Canvas artifact 嘅 per-content-hash origin）。 */
export function isScfOrigin(origin: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.scf\.usercontent\.goog$/.test(origin);
}

/**
 * 判斷一個 declared parentOrigin 係咪可接受。
 *  - SCF：生產 Gemini Canvas artifact origin。
 *  - same-origin（parentOrigin === selfOrigin）：app 嵌入自己／同 origin 測試頁，本質可信。
 *  - dev cross-port：DTR 自己跑喺 localhost／127.0.0.1 時，容許 localhost parent（方便本地測試）。
 *  生產（vercel.app）只認 SCF＋same-origin，唔會開放其他 cross-origin。
 */
export function isAllowedParentOrigin(origin: string, selfOrigin: string): boolean {
  if (isScfOrigin(origin)) return true;
  if (origin && origin === selfOrigin) return true;
  let selfHost = '';
  try { selfHost = new URL(selfOrigin).hostname; } catch { /* ignore */ }
  const isDevHost = /^(localhost|127\.0\.0\.1)$/.test(selfHost);
  if (isDevHost && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

/* ════════════════════════════════════════════════════════════════
   訊息型別
   ════════════════════════════════════════════════════════════════ */

export interface BridgeEnvelope {
  channel: typeof CHANNEL;
  version: number;
  type: string;
  requestId?: string;
}

export interface PlanPointInput {
  id?: string;
  label?: string;
  lat: number;
  lon: number;
  role?: string;
}
export interface PlanStageInput { day: number; from: string; to: string; }
export interface PlanConstraints {
  maxMovingMinutesPerDay?: number | null;
  maxAscentMPerDay?: number | null;
  targetDistanceToleranceKm?: number | null;
}
export interface RoutePlanInput {
  days?: number;
  nights?: number;
  targetTotalKm?: number;
  start: PlanPointInput;
  waypoints: PlanPointInput[];
  stages?: PlanStageInput[];
  constraints?: PlanConstraints;
}

/** 驗證後嘅正規化 plan */
export interface NormalizedPoint { id: string; label: string; lat: number; lon: number; role: string; }
export interface NormalizedPlan {
  days: number;
  nights: number;
  targetTotalKm: number | null;
  points: NormalizedPoint[];           // 有序：start → … → finish
  legDays: number[];                   // 每條 leg 屬於邊日（length = points.length - 1）
  constraints: PlanConstraints;
}

/* ════════════════════════════════════════════════════════════════
   Envelope 驗證
   ════════════════════════════════════════════════════════════════ */

export function parseEnvelope(data: unknown): BridgeEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.channel !== CHANNEL) return null;
  if (typeof d.version !== 'number') return null;
  if (typeof d.type !== 'string') return null;
  const requestId = typeof d.requestId === 'string' ? d.requestId : undefined;
  return { channel: CHANNEL, version: d.version, type: d.type, requestId };
}

/* ════════════════════════════════════════════════════════════════
   Plan 驗證（runtime schema validator；缺欄／型別錯／座標超界／CP 過多一律拒絕）
   ════════════════════════════════════════════════════════════════ */

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function validLat(v: unknown): v is number { return isFiniteNumber(v) && v >= -90 && v <= 90; }
function validLon(v: unknown): v is number { return isFiniteNumber(v) && v >= -180 && v <= 180; }

function normalizePoint(raw: unknown, fallbackId: string, errors: string[]): NormalizedPoint | null {
  if (!raw || typeof raw !== 'object') { errors.push(`point ${fallbackId} 唔係物件`); return null; }
  const p = raw as Record<string, unknown>;
  if (!validLat(p.lat)) { errors.push(`point ${fallbackId} lat 無效（必須 -90..90）`); return null; }
  if (!validLon(p.lon)) { errors.push(`point ${fallbackId} lon 無效（必須 -180..180）`); return null; }
  const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : fallbackId;
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : id;
  const role = typeof p.role === 'string' && p.role.trim() ? p.role.trim() : 'cp';
  return { id, label, lat: p.lat, lon: p.lon, role };
}

export function validatePlan(raw: unknown): { ok: true; plan: NormalizedPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['plan 唔係物件'] };
  const p = raw as Record<string, unknown>;

  const start = normalizePoint(p.start, 'start', errors);
  if (!start) return { ok: false, errors };
  start.id = 'start';
  if (start.role === 'cp') start.role = 'start';

  if (!Array.isArray(p.waypoints)) return { ok: false, errors: [...errors, 'waypoints 必須係陣列'] };
  if (p.waypoints.length === 0) return { ok: false, errors: [...errors, 'waypoints 不可為空（至少要終點）'] };
  if (p.waypoints.length + 1 > LIMITS.MAX_POINTS) {
    return { ok: false, errors: [...errors, `CP 過多（上限 ${LIMITS.MAX_POINTS} 點）`] };
  }

  const points: NormalizedPoint[] = [start];
  const seen = new Set<string>(['start']);
  p.waypoints.forEach((w, i) => {
    const np = normalizePoint(w, `wp${i + 1}`, errors);
    if (!np) return;
    if (seen.has(np.id)) { errors.push(`waypoint id 重複：${np.id}`); return; }
    seen.add(np.id);
    points.push(np);
  });
  if (errors.length) return { ok: false, errors };

  // 標記終點 role
  const last = points[points.length - 1];
  if (last.role === 'cp') last.role = 'finish';

  const legCount = points.length - 1;
  const legDays: number[] = new Array(legCount).fill(1);

  // 先用 overnight role 推斷日界（每個 overnight 之後入下一日）。
  // 呢個對「AI 自動插入中途點」稳健——唔使依赖 stages 齊全。
  const inferred: number[] = new Array(legCount).fill(1);
  {
    let day = 1;
    for (let i = 0; i < legCount; i++) {
      inferred[i] = day;
      if (points[i + 1].role === 'overnight') day++;
    }
  }

  if (Array.isArray(p.stages) && p.stages.length > 0) {
    // stages 係可選 override：有定義嘅 leg 跟 stages，缺漏嘅 leg 用 overnight 推斷補上。
    // （舊版會因「欠 stage 定義」成個 plan 拒絕；AI 加中途點後 stages 必然唔齊，故放寬。）
    const stageMap = new Map<string, number>();
    for (const s of p.stages as unknown[]) {
      if (!s || typeof s !== 'object') continue;
      const st = s as Record<string, unknown>;
      if (!isFiniteNumber(st.day) || st.day < 1) continue;
      if (typeof st.from !== 'string' || typeof st.to !== 'string') continue;
      stageMap.set(`${st.from}->${st.to}`, Math.floor(st.day));
    }
    for (let i = 0; i < legCount; i++) {
      const key = `${points[i].id}->${points[i + 1].id}`;
      const day = stageMap.get(key);
      legDays[i] = day !== undefined ? day : inferred[i];
    }
  } else {
    for (let i = 0; i < legCount; i++) legDays[i] = inferred[i];
  }

  const maxDay = Math.max(...legDays);
  if (maxDay > LIMITS.MAX_DAYS) return { ok: false, errors: [`日數過多（上限 ${LIMITS.MAX_DAYS}）`] };

  const days = isFiniteNumber(p.days) && p.days > 0 ? Math.floor(p.days) : maxDay;
  const nights = isFiniteNumber(p.nights) && p.nights >= 0 ? Math.floor(p.nights) : Math.max(days - 1, 0);
  const targetTotalKm = isFiniteNumber(p.targetTotalKm) && p.targetTotalKm > 0 ? p.targetTotalKm : null;

  const constraints: PlanConstraints = {};
  const c = (p.constraints && typeof p.constraints === 'object') ? p.constraints as Record<string, unknown> : {};
  if (isFiniteNumber(c.maxMovingMinutesPerDay) && c.maxMovingMinutesPerDay > 0) constraints.maxMovingMinutesPerDay = c.maxMovingMinutesPerDay;
  if (isFiniteNumber(c.maxAscentMPerDay) && c.maxAscentMPerDay > 0) constraints.maxAscentMPerDay = c.maxAscentMPerDay;
  if (isFiniteNumber(c.targetDistanceToleranceKm) && c.targetDistanceToleranceKm >= 0) constraints.targetDistanceToleranceKm = c.targetDistanceToleranceKm;

  return { ok: true, plan: { days, nights, targetTotalKm, points, legDays, constraints } };
}

/* ════════════════════════════════════════════════════════════════
   結果型別（回傳 Canvas）
   ════════════════════════════════════════════════════════════════ */

export interface LegResult {
  index: number;
  day: number;
  from: { id: string; label: string; lat: number; lon: number };
  to: { id: string; label: string; lat: number; lon: number };
  distanceM: number;
  ascentM: number;
  descentM: number;
  estimatedMovingMinutes: number;
  /** 係咪成功貼上山徑（BRouter）；false = 直線 fallback */
  snapped: boolean;
  mode: 'auto' | 'straight';
  /** 路段幾何（[lat,lon] 取樣，最多 ~240 點）；俾 Canvas 偵測回頭路／原路來回。可選。 */
  geometry?: Array<[number, number]>;
}
export interface DayResult {
  day: number;
  distanceM: number;
  ascentM: number;
  descentM: number;
  estimatedMovingMinutes: number;
  legIndexes: number[];
}
export interface BridgeWarning { code: string; message: string; legIndex?: number; }
export interface CriterionResult {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'unknown';
  detail: string;
}
/* ════════════════════════════════════════════════════════════════
   Phase 3.17：route:options（DTR 繞路清單）——AI 只揀唔估
   Canvas 俾骨架 baseLegs＋候選點；DTR 計每個插入後真實加幾多 km／爬升＋貼路與否。
   ════════════════════════════════════════════════════════════════ */
export interface DetourBaseLeg {
  index: number;
  from: { id: string; label: string; lat: number; lon: number };
  to: { id: string; label: string; lat: number; lon: number };
  distanceM: number;
  ascentM: number;
}
export interface DetourCandidate { id: string; label: string; lat: number; lon: number; legIndex: number; }
export interface DetourOption {
  id: string; label: string; lat: number; lon: number; legIndex: number;
  addKm: number; addAscentM: number; snapped: boolean;
}

export interface RouteResult {
  source: 'drawtheroute';
  engineVersion: string;
  bridgeVersion: string;
  computedAt: string;
  total: { distanceM: number; ascentM: number; descentM: number; estimatedMovingMinutes: number };
  days: DayResult[];
  legs: LegResult[];
  warnings: BridgeWarning[];
  criteria: CriterionResult[];
  fallbackUsed: boolean;
  humanReviewRequired: true;
}
