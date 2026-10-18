import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker, RouteSegment, NaismithSettings, LatLng } from '../../types';
import { parseCoordinateInput } from '../../services/geodeticService';
import { hoverSync } from '../../utils/hoverSync';
import { calculateBearing } from '../../utils/coordUtils';

import { useItineraryData } from '../../hooks/useItineraryData';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';

interface Props {
  profile: ElevationProfilePoint[];
  stats: RouteStats;
  waypoints: WaypointMarker[];
  segments: RouteSegment[];
  naismithSettings: NaismithSettings;
  onPointClick: (p: ElevationProfilePoint) => void;
  externalDistance?: number;
  onHoverPoint: (p: ElevationProfilePoint | null) => void;
  /** 橫切面拖曳 CP：沿路線滑動到指定里程（km） */
  onSlideWaypoint: (index: number, distanceKm: number) => void;
  /** 路程表直接改座標 */
  onSetWaypoint: (index: number, latlng: LatLng) => void;
  /** 現時正在被拖曳／高亮的路點索引 */
  draggingWaypoint?: number | null;
  /** 通知上層拖曳開始／結束 */
  onWaypointDragState?: (index: number | null) => void;
}

const CustomTooltip = ({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: ElevationProfilePoint }>;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'rgba(8,14,28,0.97)',
      border: '1px solid rgba(96,165,250,0.4)',
      borderRadius: 8,
      padding: '6px 10px',
      fontSize: 11,
      fontFamily: 'monospace',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      zIndex: 1000
    }}>
      <div style={{ color: '#60a5fa' }}>📍 {d.distance.toFixed(3)} km</div>
      <div style={{ color: '#34d399' }}>⛰️ {d.elevation} m</div>
    </div>
  );
};

/**
 * 圖表繪圖區幾何 — 必須同 <AreaChart margin> 及 <YAxis width> 完全一致，
 * 否則滑鼠位置換算里程（hover 同步、CP 拖曳命中）會有固定偏移。
 */
const CHART_MARGIN = { top: 20, right: 16, bottom: 4, left: 0 };
const Y_AXIS_WIDTH = 48;
const PLOT_LEFT = CHART_MARGIN.left + Y_AXIS_WIDTH;
const PLOT_RIGHT_PAD = CHART_MARGIN.right;

const timeToMinutes = (tStr: string) => {
  if (!tStr) return 0;
  const parts = tStr.split(":");
  if (parts.length !== 2) return 8 * 60 + 30; // default 08:30 if weird format
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
};

const minutesToTime = (mins: number) => {
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const formatMinutes = (minutes: number): string => {
  if (!minutes || minutes === 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

function StatBadge({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 6, padding: '3px 8px' }}>
      <span style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ color, fontSize: 12, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{val}</span>
    </div>
  );
}

/**
 * CoordEdit — 路線計畫表內的「可編輯座標」儲存格
 * 顯示原本嘅座標字串，點擊後可輸入 WGS84 或 UTM 簡寫，Enter／✓ 提交。
 */
function CoordEdit({ value, title, onCommit }: {
  value: string;
  title: string;
  onCommit: (raw: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = () => {
    setErr(null);
    setText(value.replace(/\s+/g, ' ').trim());
    setEditing(true);
  };

  const commit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onCommit(text);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '座標無效');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={start}
        title={`${title} — 點擊修改座標（可輸入 22.3193, 114.1694 或 50Q KK 0670 2346）`}
        className="w-full text-left font-mono text-[10px] text-slate-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors px-2 py-1.5 group/coord"
      >
        {value}
        <span className="opacity-0 group-hover/coord:opacity-100 ml-1 text-blue-400">✎</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-1 bg-blue-950/40">
      <input
        autoFocus
        value={text}
        disabled={busy}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setErr(null); }
        }}
        placeholder="22.3193, 114.1694"
        className="w-full bg-slate-900 border border-blue-500/50 rounded px-1.5 py-1 text-[10px] font-mono text-white outline-none focus:border-blue-400"
      />
      <div className="flex items-center gap-1">
        <button
          onClick={() => void commit()}
          disabled={busy}
          className="flex-1 text-[9px] font-bold rounded bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 px-1 py-0.5 disabled:opacity-50"
        >
          {busy ? '轉換中…' : '✓ 套用'}
        </button>
        <button
          onClick={() => { setEditing(false); setErr(null); }}
          className="text-[9px] rounded border border-slate-600/60 text-slate-400 hover:bg-slate-700/40 px-1.5 py-0.5"
        >
          ✕
        </button>
      </div>
      {err && <span className="text-[9px] text-rose-400 leading-tight">{err}</span>}
    </div>
  );
}

/**
 * CpHandle — 橫切面上可拖曳的 CP 手柄（拖曳 = 沿路線滑動 CP）
 */
function CpHandle(props: {
  cx?: number; cy?: number;
  /** 用 tone（唔用 fill）傳色：recharts 會用自身預設 fill 覆蓋同名的 shape prop */
  tone?: string;
  label?: string;
  dragging?: boolean;
}) {
  const { cx, cy, tone = '#fbbf24', label, dragging = false } = props;
  if (cx == null || cy == null) return null;
  const color = dragging ? '#f8fafc' : tone;

  // 純視覺：實際拖曳由圖表容器嘅 pointer 事件處理（命中範圍 ±14px，滑鼠／手指都按得到）
  return (
    <g style={{ cursor: 'ew-resize', touchAction: 'none', pointerEvents: 'none' }}>
      <title>{`拖曳沿路線移動 ${label ?? 'CP'}`}</title>
      {/* 加大命中範圍（透明填充都算 hit area） */}
      <rect x={cx - 14} y={cy - 26} width={28} height={54} fill="transparent" />
      <path d={`M ${cx - 5} ${cy - 10} L ${cx + 5} ${cy - 10} L ${cx} ${cy - 18} Z`} fill={color} opacity={0.9} />
      <circle cx={cx} cy={cy} r={dragging ? 9 : 7.5} fill="rgba(8,14,28,0.9)" stroke={color} strokeWidth={dragging ? 3 : 2} />
      <circle cx={cx} cy={cy} r={3.5} fill={color} />
      {dragging && (
        <circle cx={cx} cy={cy} r={14} fill="none" stroke={color} strokeWidth={1} opacity={0.6} />
      )}
    </g>
  );
}

export default function ElevationChart({
  profile,
  stats,
  waypoints,
  segments,
  naismithSettings,
  onPointClick,
  externalDistance,
  onHoverPoint,
  onSlideWaypoint,
  onSetWaypoint,
  draggingWaypoint = null,
  onWaypointDragState,
}: Props) {
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [activePoint, setActivePoint] = useState<ElevationProfilePoint | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const [coordMode, setCoordMode] = useState<'grid' | 'latlng'>('grid');

  // ── 橫切面 CP 拖曳狀態 ────────────────────────────────────────────────
  const draggingRef = useRef<number | null>(null);
  const [localDragIdx, setLocalDragIdx] = useState<number | null>(null);
  const lastSlideKmRef = useRef<number | null>(null);
  /** 按下時嘅候選拖曳（要移動超過 3px 才真正開始，避免誤觸） */
  const dragStateRef = useRef<{ idx: number; startX: number; startY: number; active: boolean } | null>(null);
  const justDraggedRef = useRef(false);

  const endCpDrag = useCallback(() => {
    if (dragStateRef.current?.active) onWaypointDragState?.(null);
    dragStateRef.current = null;
    draggingRef.current = null;
    lastSlideKmRef.current = null;
    setLocalDragIdx(null);
  }, [onWaypointDragState]);

  useEffect(() => {
    const finish = () => endCpDrag();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [endCpDrag]);

  
  // Custom Intervals for Chart
  const [xInterval, setXInterval] = useState<string>('');
  const [yInterval, setYInterval] = useState<string>('');

  /**
   * 刻度間距與座標軸範圍（domain）必須「一起動」：
   * 一旦輸入自訂間距，domain 會向上取整成間距的整數倍，
   * 剖面圖因此跟著重新縮放 —— 唔會出現「只得軸數字跳、剖面唔郁」
   * 導致山頂高度讀錯（例如 400m 山頂被拉成看似 1000m）嘅情況。
   * 無輸入時維持原本自動（data-driven）domain。
   */
  const { xDomain, xTicks, yDomain, yTicks } = useMemo(() => {
    // Y：最高高度（沿用原本 100m 進位 + 頂部留白）
    let fMax = 0;
    if (profile.length) {
      const elevs = profile.map(p => p.elevation);
      const maxE = Math.max(...elevs);
      const roundedMax = Math.ceil(maxE / 100) * 100;
      fMax = (roundedMax - maxE < 30) ? roundedMax + 100 : roundedMax;
    }
    // X：總里程
    const base = stats.totalDistance;

    /** 將 domain 對齊到 step 的整數倍，並產生該範圍內嘅刻度 */
    const buildLadder = (maxVal: number, step: number) => {
      const steps = Math.max(1, Math.ceil(maxVal / step - 1e-9));
      const top = +(steps * step).toFixed(6);
      const arr: number[] = [];
      for (let i = 0; i <= steps; i++) arr.push(+(i * step).toFixed(6));
      return { top, arr };
    };

    // 防止極端小間距產生天文數字嘅刻度陣列（超過就當冇輸入，維持自動）
    const xVal = parseFloat(xInterval);
    const xCustom = (!isNaN(xVal) && xVal > 0 && base > 0 && base / xVal <= 10000)
      ? buildLadder(base, xVal) : null;

    const yVal = parseFloat(yInterval);
    const yCustom = (!isNaN(yVal) && yVal > 0 && fMax > 0 && fMax / yVal <= 10000)
      ? buildLadder(fMax, yVal) : null;

    return {
      xDomain: [0, xCustom ? xCustom.top : base] as [number, number],
      xTicks: xCustom ? xCustom.arr : [],
      yDomain: [0, yCustom ? yCustom.top : fMax] as [number, number],
      yTicks: yCustom ? yCustom.arr : [],
    };
  }, [profile, stats.totalDistance, xInterval, yInterval]);

  // Header form states
  const [headerInfo, setHeaderInfo] = useState({
    region: '', team: '', mapGroup: '', year: '', leader: ''
  });
  
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const { materials, weather } = useItineraryData(waypoints, segments, selectedDate);

  // Table form states
  const [startTime, setStartTime] = useState("08:30");
  const [wpNames, setWpNames] = useState<Record<number, string>>({});
  const [leaders, setLeaders] = useState<Record<number, string>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [routeRests, setRouteRests] = useState<Record<number, number>>({});
  const [cpRests, setCpRests] = useState<Record<number, number>>({});

  const schedule = useMemo(() => {
    const dep: string[] = [];
    const arr: string[] = [];
    if (!waypoints.length) return { dep, arr };
    
    dep[0] = startTime;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;
        const baseTime = (seg.distance / naismithSettings.baseSpeedKmh) * 60;
        const ascTime = (seg.ascent / 20) * naismithSettings.ascentPer20m;
        const descTime = (seg.descent / 20) * naismithSettings.descentPer20m;
        const walk = Math.round(baseTime + ascTime + descTime);

        const rRest = routeRests[i] || 0;
        const cRest = cpRests[i] || 0;

        const startMins = timeToMinutes(dep[i]);
        const arrMins = startMins + walk + rRest;
        arr[i] = minutesToTime(arrMins);

        if (i + 1 < waypoints.length) {
            dep[i + 1] = minutesToTime(arrMins + cRest);
        }
    }
    return { dep, arr };
  }, [waypoints.length, segments, startTime, routeRests, cpRests, naismithSettings]);

  const markers = useMemo(() => {
    if (!profile.length || !waypoints.length) return [];
    return waypoints.map((wp, idx) => {
      let closest = profile[0];
      let minDiff = Infinity;
      for (const p of profile) {
        const diff = Math.pow(p.lat - wp.latlng.lat, 2) + Math.pow(p.lng - wp.latlng.lng, 2);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }
      const isSP = idx === 0;
      const isEP = idx === waypoints.length - 1;
      return {
        x: closest.distance,
        y: closest.elevation,
        label: isSP ? 'SP' : (isEP ? 'EP' : `CP${idx}`),
        color: isSP ? '#10b981' : (isEP ? '#f87171' : '#fbbf24')
      };
    });
  }, [profile, waypoints]);

  const markerElev = useMemo(() => markers.map(m => m.y), [markers]);

  /** 繪圖區寬度（扣除 Y 軸與右側留白） */
  const plotWidthOf = useCallback((containerWidth: number) =>
    Math.max(1, containerWidth - PLOT_LEFT - PLOT_RIGHT_PAD), []);

  /** 滑鼠 x（client 座標）→ 里程 km（跟隨 X 軸 domain，唔係硬扣 totalDistance） */
  const kmOfClientX = useCallback((clientX: number) => {
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect || !xDomain[1]) return null;
    const plotWidth = plotWidthOf(rect.width);
    const rel = Math.max(0, Math.min(clientX - rect.left - PLOT_LEFT, plotWidth));
    return (rel / plotWidth) * xDomain[1];
  }, [plotWidthOf, xDomain]);

  /** 里程 km → 繪圖區 x（相對容器左邊） */
  const pixelOfKm = useCallback((km: number, containerWidth: number) =>
    PLOT_LEFT + (km / Math.max(xDomain[1], 0.0001)) * plotWidthOf(containerWidth),
    [plotWidthOf, xDomain]);

  /** 按下時若貼近某個 CP 標記（±14px）就準備拖曳（真正移動超過 3px 才算拖曳） */
  const handleContainerPointerDown = useCallback((e: React.PointerEvent) => {
    if (!chartContainerRef.current || !profile.length || markers.length === 0) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let bestIdx = -1;
    let bestDx = Infinity;
    markers.forEach((m, i) => {
      const dx = Math.abs(pixelOfKm(m.x, rect.width) - x);
      if (dx < bestDx) { bestDx = dx; bestIdx = i; }
    });
    if (bestDx > 14) return;
    dragStateRef.current = { idx: bestIdx, startX: x, startY: y, active: false };
  }, [profile.length, markers, pixelOfKm]);

  useEffect(() => {
    if (externalDistance !== undefined && profile.length > 0) {
      setHoverX(externalDistance);
      // find closest point in profile for the tooltip
      let closest = profile[0];
      let minDiff = Math.abs(profile[0].distance - externalDistance);
      for (const p of profile) {
        const diff = Math.abs(p.distance - externalDistance);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }
      onHoverPoint(closest);
    }
  }, [externalDistance, profile, onHoverPoint]);

  // 🚀 監聽同步：直接更新 activePoint 狀態，讓圖表內部點亮
  useEffect(() => {
    const unsubscribe = hoverSync.subscribe((payload, source) => {
      if (payload && profile.length > 0) {
        setActivePoint(payload);
        setHoverX(payload.distance);
        onHoverPoint(payload);
      } else {
        setActivePoint(null);
        setHoverX(null);
      }
    });
    return unsubscribe;
  }, [profile, onHoverPoint]);

  const onMove = useCallback((e: any) => {
    if (e?.activePayload?.[0]) {
      const pt = e.activePayload[0].payload as ElevationProfilePoint;
      setActivePoint(pt);
      setHoverX(pt.distance);
      hoverSync.emit(pt, 'chart');
    }
  }, []);

  // 🚀 新增：原生容器監聽，解決 Recharts hit-test 不靈敏問題，實現「黏著」感
  const handleContainerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!chartContainerRef.current || !profile.length) return;
    
    const rect = chartContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // 扣除 Y 軸寬度與 margin：left = margin.left + YAxis.width，right = margin.right
    const chartWidth = plotWidthOf(rect.width);
    const relativeX = Math.max(0, Math.min(x - PLOT_LEFT, chartWidth));
    const targetDist = (relativeX / chartWidth) * xDomain[1];
    
    // 在 profile 中尋找距離 targetDist 最近的點（targetDist 已按 domain 縮放）
    let closest = profile[0];
    let minDiff = Math.abs(profile[0].distance - targetDist);
    for (let i = 1; i < profile.length; i++) {
      const diff = Math.abs(profile[i].distance - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closest = profile[i];
      }
    }
    
    // 候選拖曳：移動超過 3px 才正式開始（避免誤觸；單純點擊維持原本「跳游標」行為）
    const st = dragStateRef.current;
    if (st) {
      const moved = Math.hypot(x - st.startX, (e.clientY - rect.top) - st.startY);
      if (!st.active && moved > 3) {
        st.active = true;
        draggingRef.current = st.idx;
        justDraggedRef.current = true;
        setLocalDragIdx(st.idx);
        onWaypointDragState?.(st.idx);
      }
    }

    // 拖曳 CP 中 → 只更新 CP 位置（沿路線滑動），唔搶高程游標
    const dragIdx = draggingRef.current;
    if (dragIdx !== null) {
      const last = lastSlideKmRef.current;
      // 每 20m 才觸發一次重算，避免拖曳時發出過多請求
      if (last === null || Math.abs(closest.distance - last) >= 0.02) {
        lastSlideKmRef.current = closest.distance;
        onSlideWaypoint(dragIdx, closest.distance);
      }
      return;
    }

    setActivePoint(closest);
    setHoverX(closest.distance);
    hoverSync.emit(closest, 'chart');
  }, [profile, xDomain, plotWidthOf, onSlideWaypoint, onWaypointDragState]);


  const onClickChart = useCallback((e: any) => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    if (e?.activePayload?.[0]) {
      const pt = e.activePayload[0].payload as ElevationProfilePoint;
      onPointClick(pt);
    }
  }, [onPointClick]);

  const onLeave = useCallback(() => {
    setHoverX(null);
    hoverSync.emit(null, 'chart');     // 🚀 指定來源為 chart
  }, []);

  const handleDownloadChartPNG = async () => {
    const chartContainer = document.querySelector('.recharts-wrapper') as HTMLElement;
    if (!chartContainer) return alert('找不到圖表畫面！');
    try {
      const canvas = await html2canvas(chartContainer, { scale: 2, backgroundColor: '#0f172a' });
      const link = document.createElement('a');
      link.download = `橫切面剖面圖-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error(err);
      alert('PNG 下載失敗');
    }
  };

  const handleExportExcel = () => {
    if (waypoints.length < 2) return alert('請先建立路線！');

    try {
      const wb = XLSX.utils.book_new();
      const wsAOA: any[][] = [];

      wsAOA.push(["第二日"]);

      wsAOA.push([
        `地圖組別: ${headerInfo.mapGroup}`, "", 
        `編號及年份: ${headerInfo.year}`, "", "",
        `起點: ${wpNames[0] || ""}`, "", "", "", "", "", "", "",
        `終點: ${wpNames[waypoints.length - 1] || ""}`, "", "", "", "", "", "", "", "", "", "", "", ""
      ]);

      wsAOA.push([
        "路段", "CP", "地理名稱(出發)", "出發點\n(座標 50Q)", "CP", "地理名稱(到達)", "到達點\n(座標 50Q)",
        "起始高度", "分段\n上升", "累積\n上升", "分段\n下降", "累積\n下降", "累積\n上下降",
        "前視方向", "距離\n(km)", "累積距離\n(km)", 
        "步行\n(min)", "路線休息\n(min)", "CP休息\n(min)", "總需時\n(min)",
        "預計出發", "預計到達", "實際出發", "實際到達",
        "領航員", "備註"
      ]);

      let cumulativeDist = 0;
      let cumulativeAscent = 0;
      let cumulativeDescent = 0;

      for (let i = 0; i < waypoints.length - 1; i++) {
        const wp1 = waypoints[i];
        const wp2 = waypoints[i + 1];
        const seg = segments[i];
        
        cumulativeDist += seg.distance;
        cumulativeAscent += seg.ascent;
        cumulativeDescent += seg.descent;

        const coords1 = coordMode === 'grid' && materials && materials[i]?.grid ? materials[i].grid : `${wp1.latlng.lat.toFixed(4)}, ${wp1.latlng.lng.toFixed(4)}`;
        const coords2 = coordMode === 'grid' && materials && materials[i+1]?.grid ? materials[i+1].grid : `${wp2.latlng.lat.toFixed(4)}, ${wp2.latlng.lng.toFixed(4)}`;

        const baseTime = (seg.distance / naismithSettings.baseSpeedKmh) * 60;
        const ascTime = (seg.ascent / 20) * naismithSettings.ascentPer20m;
        const descTime = (seg.descent / 20) * naismithSettings.descentPer20m;
        const walk = Math.round(baseTime + ascTime + descTime);
        const rRest = routeRests[i] || 0;
        const cRest = cpRests[i] || 0;

        wsAOA.push([
          (i + 1).toString(),
          i === 0 ? 'SP' : `CP${i}`,
          wpNames[i] || "",
          coords1,
          i + 1 === waypoints.length - 1 ? 'EP' : `CP${i+1}`,
          wpNames[i+1] || "",
          coords2,
          Math.round((wp1 as any).elevation || 0),
          Math.round(seg.ascent),
          Math.round(cumulativeAscent),
          Math.round(seg.descent),
          Math.round(cumulativeDescent),
          Math.round(cumulativeAscent + cumulativeDescent),
          `${calculateBearing(wp1.latlng.lat, wp1.latlng.lng, wp2.latlng.lat, wp2.latlng.lng)}°`,
          seg.distance.toFixed(2),
          cumulativeDist.toFixed(2),
          walk,
          rRest,
          cRest,
          walk + rRest + cRest,
          schedule.dep[i] || "--:--",
          schedule.arr[i] || "--:--",
          "", 
          "", 
          leaders[i] || "",
          remarks[i] || ""
        ]);
      }

      wsAOA.push([]);
      wsAOA.push([]);

      const footerAOA = [
        ["【 📊 行程統計 (Stats) 】", "", "", "", "", "", ""],
        [
          "總距離：", `${stats?.totalDistance?.toFixed(2)} km`, "",
          "總上升 / 下降：", `+${stats?.totalAscent?.toFixed(0)} m / -${stats?.totalDescent?.toFixed(0)} m`, "",
          "最高高度：", `${stats?.maxElevation?.toFixed(0)} m`
        ],
        [
          "預計總時間：", formatMinutes(stats?.estimatedTime || 0), "",
          "", "", "", ""
        ],
        [],
        ["【 ☀️ 天文數據 (ASTRO) 】", "", "", "【 ⏱️ Naismith 時間算法基準 】", "", "", "【 🌦️ 氣象預測 (Weather Forecast) 】"],
        [
          "🌅 日出 / 日落：", weather ? `${weather.sunrise} / ${weather.sunset}` : "--:-- / --:--", "",
          "基礎時速：", `${naismithSettings?.baseSpeedKmh || "4.0"} km/h`, "",
          "🌡️ 當日最高 / 最低溫：", weather && weather.maxTemp !== undefined && weather.minTemp !== undefined ? `${weather.maxTemp}°C / ${weather.minTemp}°C` : "26°C / 18°C"
        ],
        [
          "🌙 月出 / 月落：", weather ? `${weather.moonrise} / ${weather.moonset}` : "--:-- / --:--", "",
          "每上升 20m 加時：", `+${naismithSettings?.ascentPer20m || "10"} 分`, "",
          "💧 相對濕度：", weather && weather.humidity !== undefined ? `${weather.humidity}%` : "78%"
        ],
        [
          "🌑 月相：", weather ? String(weather.moonPhase).replace(/<\/?[^>]+(>|$)/g, "") : "--", "",
          "每下降 20m 加時：", `+${naismithSettings?.descentPer20m || "0"} 分`, "",
          "☁️ 雲量 / 降雨：", weather ? `${weather.cloudCover}% / ${weather.precipitation}%` : "40% / 10%"
        ],
        [
          "🌊 潮汐預報：", weather ? weather.tideForecast : "--:-- / --:--", "",
          "", "", "", 
          "🚩 風向風速：", weather ? `${weather.windDirection || "E"} ${weather.windSpeed || "15"} km/h` : "E 15 km/h"
        ],
        [
          "", "", "", 
          "", "", "", 
          "☀️ 紫外線：", weather ? `指數 (${weather.uvIndex})` : "中等 (5)"
        ]
      ];

      footerAOA.forEach(row => wsAOA.push(row));

      const finalWs = XLSX.utils.aoa_to_sheet(wsAOA);

      const merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 25 } }, 
        { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },  
        { s: { r: 1, c: 2 }, e: { r: 1, c: 4 } },  
        { s: { r: 1, c: 5 }, e: { r: 1, c: 12 } }, 
        { s: { r: 1, c: 13 }, e: { r: 1, c: 25 } }, 
      ];
      finalWs['!merges'] = merges;

      finalWs['!cols'] = [
        { wch: 6 },  { wch: 6 },  { wch: 18 }, { wch: 18 }, { wch: 6 },  { wch: 18 }, { wch: 18 }, 
        { wch: 10 }, { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 10 }, 
        { wch: 10 }, { wch: 10 }, { wch: 14 }, 
        { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, 
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, 
        { wch: 12 }, { wch: 20 }
      ];

      XLSX.utils.book_append_sheet(wb, finalWs, "行程表");
      XLSX.writeFile(wb, `行程表_${selectedDate || "未命名"}.xlsx`);
    } catch (err: any) {
      console.error("Excel 匯出失敗:", err);
      alert(`EXCEL 匯出失敗: ${err?.message || err}`);
    }
  };

  if (!profile.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-4xl opacity-15">🏔️</div>
        <p className="text-slate-500 text-sm">點擊地圖上任意兩點開始規劃山徑</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        
        {/* Top Left: Tabs & Inputs */}
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 rounded-lg p-1 shrink-0">
            <button onClick={() => setActiveTab('chart')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'chart' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>高度剖面</button>
            <button onClick={() => setActiveTab('table')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>路程計畫表</button>
          </div>
          {activeTab === 'chart' && (
            <div className="flex gap-4 text-xs border-l border-slate-700 pl-4">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">X軸(km):</span>
                <input type="number" step="0.1" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-16 text-white text-center outline-none focus:border-blue-500" value={xInterval} onChange={(e) => setXInterval(e.target.value)} placeholder="自動" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Y軸(m):</span>
                <input type="number" step="10" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-16 text-white text-center outline-none focus:border-blue-500" value={yInterval} onChange={(e) => setYInterval(e.target.value)} placeholder="自動" />
              </div>
            </div>
          )}
        </div>

        {/* Top Middle: Stats Panel */}
        <div className="flex gap-2 flex-wrap flex-1 justify-center shrink-0">
          <StatBadge label="總距離" val={`${stats?.totalDistance?.toFixed(2) || 0} km`} color="#a78bfa" />
          <StatBadge label="總上升" val={`+${stats?.totalAscent?.toFixed(0) || 0} m`} color="#34d399" />
          <StatBadge label="總下降" val={`-${stats?.totalDescent?.toFixed(0) || 0} m`} color="#fb7185" />
          <StatBadge label="最高高度" val={`${stats?.maxElevation?.toFixed(0) || 0} m`} color="#e2e8f0" />
          <StatBadge label="預計時間" val={formatMinutes(stats?.estimatedTime || 0)} color="#fcd34d" />
        </div>

        {/* Top Right: Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {activeTab === 'chart' ? (
            <button onClick={handleDownloadChartPNG} className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-3 py-1.5 rounded text-xs font-medium border border-blue-500/30 transition-colors">下載 PNG</button>
          ) : (
            <button onClick={handleExportExcel} className="bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded text-xs font-medium border border-green-500/30 transition-colors flex items-center gap-1">下載 EXCEL</button>
          )}
        </div>
      </div>

      {activeTab === 'chart' ? (
        <div 
          className="flex-1 min-h-0 relative" 
          ref={chartContainerRef} 
          style={{ touchAction: 'none' }}
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handleContainerPointerMove}
          onMouseLeave={onLeave}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={profile} 
              onClick={onClickChart}
              margin={CHART_MARGIN}
            >
              <defs>
                <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.01} />
                </linearGradient>
                {/* 🚀 讓光點「亮起來」的 SVG 發光濾鏡 */}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
              <XAxis dataKey="distance" type="number" domain={xDomain} tickFormatter={(v) => v.toFixed(1)} stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} tickMargin={8} {...(xTicks.length > 0 ? { ticks: xTicks } : {})} />
              <YAxis width={Y_AXIS_WIDTH} domain={yDomain} stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} tickMargin={8} tickFormatter={(v) => Math.round(v).toString()} {...(yTicks.length > 0 ? { ticks: yTicks } : {})} />
              <Tooltip content={<CustomTooltip />} />
              {markers.map((m, i) => (
                <ReferenceLine key={i} x={m.x} stroke={m.color} strokeOpacity={0.5} strokeDasharray="3 3" label={{ position: 'top', value: m.label, fill: m.color, fontSize: 10, fontWeight: 600 }} />
              ))}
              {/* 🖐️ 可拖曳 CP 手柄：拖曳 = 沿路線滑動 CP 位置（起點／終點只可拖兩端） */}
              {markers.map((m, i) => (
                <ReferenceDot
                  key={`cp-drag-${i}-${m.x.toFixed(3)}`}
                  x={m.x}
                  y={markerElev[i]}
                  r={0}
                  ifOverflow="extendDomain"
                  shape={
                    <CpHandle
                      tone={m.color}
                      label={m.label}
                      dragging={(localDragIdx ?? draggingWaypoint) === i}
                    />
                  }
                />
              ))}
              <Area type="monotone" dataKey="elevation" stroke="#60a5fa" strokeWidth={2} fillOpacity={1} fill="url(#elev-grad)" isAnimationActive={false} />
              
              {/* 🚀 核心：直接在圖表內部點亮對應的點 */}
              {activePoint && (
                <ReferenceDot 
                  x={activePoint.distance} 
                  y={activePoint.elevation} 
                  r={4} 
                  fill="#fff" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  filter="url(#glow)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 mb-2 px-1 text-[10px] text-blue-300/90 shrink-0">
            <span className="px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 font-bold">✎ 改 CP 座標</span>
            <span className="text-slate-400">
              點擊下面「起點／終點座標」格即可輸入（支援 <span className="font-mono text-slate-300">22.3193, 114.1694</span>
              或 <span className="font-mono text-slate-300">50Q KK 0670 2346</span>），套用後相鄰路段會自動重算。
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">遠足地區：</span>
              <input value={headerInfo.region} onChange={e => setHeaderInfo({...headerInfo, region: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="地區..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">日期：</span>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">組員姓名：</span>
              <input value={headerInfo.team} onChange={e => setHeaderInfo({...headerInfo, team: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="姓名..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">地圖組別：</span>
              <input value={headerInfo.mapGroup} onChange={e => setHeaderInfo({...headerInfo, mapGroup: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="HM20C..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">編號及年份：</span>
              <input value={headerInfo.year} onChange={e => setHeaderInfo({...headerInfo, year: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="2024..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">領隊：</span>
              <input value={headerInfo.leader} onChange={e => setHeaderInfo({...headerInfo, leader: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 overflow-x-auto flex-1 mb-4">
            <table className="w-full border-collapse text-[10px] min-w-[2400px]">
              <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
                <tr>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-10">路段</th>
                  <th colSpan={3} className="border border-slate-700 p-2 text-center text-blue-300">出發點</th>
                  <th colSpan={3} className="border border-slate-700 p-2 text-center text-rose-300">到達點</th>
                  <th colSpan={6} className="border border-slate-700 p-2 text-center text-emerald-400">高度 (m)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-14">前視<br/>方位</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">距離 (km)</th>
                  <th colSpan={4} className="border border-slate-700 p-2 text-amber-400 text-center">需時 (min)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-blue-400 text-center">預計時間</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-slate-400 text-center">實際時間 (手寫)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-20">領航員</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 min-w-[120px]">備註</th>
                </tr>
                <tr className="text-slate-400 font-normal">
                  <th className="border border-slate-700 p-1 w-10">CP</th>
                  <th className="border border-slate-700 p-1 w-24">名稱</th>
                  <th className="border border-slate-700 p-1 w-28 cursor-pointer hover:text-white" onClick={() => setCoordMode(coordMode === 'grid' ? 'latlng' : 'grid')}>座標<br/>(按此切換)</th>
                  <th className="border border-slate-700 p-1 w-10">CP</th>
                  <th className="border border-slate-700 p-1 w-24">名稱</th>
                  <th className="border border-slate-700 p-1 w-28">座標</th>
                  
                  <th className="border border-slate-700 p-1 w-12 text-slate-300">起始</th>
                  <th className="border border-slate-700 p-1 w-12 text-emerald-400">上升</th>
                  <th className="border border-slate-700 p-1 w-12 text-emerald-500">累積上升</th>
                  <th className="border border-slate-700 p-1 w-12 text-rose-400">下降</th>
                  <th className="border border-slate-700 p-1 w-12 text-rose-500">累積下降</th>
                  <th className="border border-slate-700 p-1 w-14 text-slate-300">累積上下降</th>
                  
                  <th className="border border-slate-700 p-1 w-12 text-purple-400">分段</th>
                  <th className="border border-slate-700 p-1 w-12 text-purple-500">累積</th>
                  
                  <th className="border border-slate-700 p-1 w-12 text-amber-300">步行</th>
                  <th className="border border-slate-700 p-1 w-14 text-amber-400">路線休息</th>
                  <th className="border border-slate-700 p-1 w-14 text-amber-400">CP休息</th>
                  <th className="border border-slate-700 p-1 w-14 text-amber-500">本段總計</th>
                  
                  <th className="border border-slate-700 p-1 w-16 text-blue-400">出發<br/>(首格可填)</th>
                  <th className="border border-slate-700 p-1 w-16 text-blue-400">到達</th>
                  
                  <th className="border border-slate-700 p-1 w-16">出發</th>
                  <th className="border border-slate-700 p-1 w-16">到達</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  if (waypoints.length < 2) return null;
                  let cumulativeDist = 0;
                  let cumulativeAscent = 0;
                  let cumulativeDescent = 0;

                  return Array.from({ length: waypoints.length - 1 }).map((_, i) => {
                    const wp1 = waypoints[i];
                    const wp2 = waypoints[i + 1];
                    const segment = segments[i];
                    if (!segment) return null;

                    cumulativeDist += segment.distance;
                    cumulativeAscent += segment.ascent;
                    cumulativeDescent += segment.descent;
                    
                    const baseTime = (segment.distance / naismithSettings.baseSpeedKmh) * 60;
                    const ascTime = (segment.ascent / 20) * naismithSettings.ascentPer20m;
                    const descTime = (segment.descent / 20) * naismithSettings.descentPer20m;
                    const walkMins = Math.round(baseTime + ascTime + descTime);

                    const isLastSeg = i === waypoints.length - 2;
                    const getCoords = (wp: WaypointMarker, idx: number) => {
                      if (coordMode === 'grid' && materials && materials[idx]?.grid) return materials[idx].grid;
                      return `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;
                    };

                    const rRest = routeRests[i] || 0;
                    const cRest = cpRests[i] || 0;

                    return (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20 text-center">
                        <td className="p-2 border border-slate-700 text-slate-300 font-bold">{i + 1}</td>
                        <td className="p-2 border border-slate-700 text-blue-400 font-bold">{i === 0 ? 'SP' : `CP${i}`}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" value={wpNames[i] || ''} onChange={(e) => setWpNames(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <CoordEdit
                            value={getCoords(wp1, i)}
                            title={`${i === 0 ? '起點' : `CP${i}`} 座標`}
                            onCommit={async (raw) => onSetWaypoint(i, await parseCoordinateInput(raw))}
                          />
                        </td>
                        
                        <td className="p-2 border border-slate-700 text-rose-400 font-bold">{isLastSeg ? 'EP' : `CP${i + 1}`}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" value={wpNames[i + 1] || ''} onChange={(e) => setWpNames(prev => ({ ...prev, [i + 1]: e.target.value }))} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <CoordEdit
                            value={getCoords(wp2, i + 1)}
                            title={`${isLastSeg ? '終點' : `CP${i + 1}`} 座標`}
                            onCommit={async (raw) => onSetWaypoint(i + 1, await parseCoordinateInput(raw))}
                          />
                        </td>
                        
                        <td className="p-2 border border-slate-700 text-slate-300">{Math.round((wp1 as any).elevation || 0)}</td>
                        <td className="p-2 border border-slate-700 text-emerald-400">+{Math.round(segment.ascent)}</td>
                        <td className="p-2 border border-slate-700 text-emerald-500 opacity-80">+{Math.round(cumulativeAscent)}</td>
                        <td className="p-2 border border-slate-700 text-rose-400">-{Math.round(segment.descent)}</td>
                        <td className="p-2 border border-slate-700 text-rose-500 opacity-80">-{Math.round(cumulativeDescent)}</td>
                        <td className="p-2 border border-slate-700 text-slate-300 font-bold">{Math.round(cumulativeAscent + cumulativeDescent)}</td>
                        
                        <td className="p-2 border border-slate-700 text-amber-500 font-bold italic">{`${calculateBearing(wp1.latlng.lat, wp1.latlng.lng, wp2.latlng.lat, wp2.latlng.lng)}°`}</td>
                        
                        <td className="p-2 border border-slate-700 text-purple-400">{segment.distance.toFixed(2)}</td>
                        <td className="p-2 border border-slate-700 text-purple-500 opacity-80">{cumulativeDist.toFixed(2)}</td>
                        
                        <td className="p-2 border border-slate-700 font-bold text-amber-200 font-mono">{walkMins}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input type="number" className="w-full bg-transparent p-2 text-center outline-none text-amber-400 font-mono [appearance:textfield]" value={rRest || ''} onChange={(e) => { const val = parseInt(e.target.value) || 0; setRouteRests(prev => ({ ...prev, [i]: val })); }} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input type="number" className="w-full bg-transparent p-2 text-center outline-none text-amber-400 font-mono [appearance:textfield]" value={cRest || ''} onChange={(e) => { const val = parseInt(e.target.value) || 0; setCpRests(prev => ({ ...prev, [i]: val })); }} />
                        </td>
                        <td className="p-2 border border-slate-700 font-bold text-amber-500 font-mono">{walkMins + rRest + cRest}</td>
                        
                        <td className="p-0 border border-slate-700 bg-slate-900/50">
                          {i === 0 ? (
                            <input type="time" className="w-full bg-transparent p-2 text-center outline-none text-blue-300 font-mono font-bold" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                          ) : (
                            <div className="p-2 font-mono font-bold text-blue-300">{schedule.dep[i]}</div>
                          )}
                        </td>
                        <td className="p-2 border border-slate-700 font-bold font-mono text-blue-400">{schedule.arr[i]}</td>
                        
                        <td className="p-0 border border-slate-700 bg-white/5"><input className="w-full bg-transparent p-2 text-center outline-none text-slate-400 font-mono" placeholder="--:--" /></td>
                        <td className="p-0 border border-slate-700 bg-white/5"><input className="w-full bg-transparent p-2 text-center outline-none text-slate-400 font-mono" placeholder="--:--" /></td>
                        
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 text-center outline-none text-white text-[11px]" value={leaders[i] || ''} onChange={(e) => setLeaders(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 text-left outline-none text-white text-[10px]" value={remarks[i] || ''} onChange={(e) => setRemarks(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          <div className="mt-auto grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800 shrink-0">
            <div className="space-y-2">
              <span className="text-red-400 text-[10px] uppercase font-bold flex items-center gap-1">☀️ 天文數據 (ASTRO)</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">日出/日落</span><span className="text-purple-400 text-xs">🌅 {weather ? `${weather.sunrise} / ${weather.sunset}` : "--:-- / --:--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月出/月落</span><span className="text-purple-400 text-xs">🌙 {weather ? `${weather.moonrise} / ${weather.moonset}` : "--:-- / --:--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月相</span><span className="text-purple-400 text-xs">{weather ? String(weather.moonPhase).replace(/<\/?[^>]+(>|$)/g, "") : "--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">潮汐預報</span><span className="text-blue-400 text-[10px]">🌊 {weather ? weather.tideForecast : "--:-- / --:--"}</span></div>
              </div>
            </div>
            <div className="lg:col-span-3 border-l border-slate-800 pl-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <span className="text-emerald-400 text-[10px] uppercase font-bold flex items-center gap-1">⏱️ Naismith 時間算法基準 (唯讀反映)</span>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">基礎時速</span><span className="text-blue-400 text-sm font-bold font-mono">{naismithSettings.baseSpeedKmh} km/h</span></div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">每上升 20m 加時</span><span className="text-emerald-400 text-sm font-bold font-mono">+{naismithSettings.ascentPer20m} 分</span></div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">每下降 20m 加時</span><span className="text-rose-400 text-sm font-bold font-mono">+{naismithSettings.descentPer20m} 分</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-blue-400 text-[10px] uppercase font-bold flex items-center gap-1">🌦️ 氣象預測 (Weather Forecast)</span>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                 <div className="flex flex-col">
                  <span className="text-slate-500 text-[9px]">當日最高 / 最低溫</span>
                  <span className="text-orange-400 text-xs font-bold">{weather && weather.maxTemp !== undefined && weather.minTemp !== undefined ? `${weather.maxTemp}°C / ${weather.minTemp}°C` : "26°C / 18°C"}</span>
                 </div>
                 <div className="flex flex-col"><span className="text-slate-500 text-[9px]">相對濕度</span><span className="text-blue-300 text-xs font-bold">{weather && weather.humidity !== undefined ? `${weather.humidity}%` : "78%"}</span></div>
                 <div className="flex flex-col"><span className="text-slate-500 text-[9px]">雲量 / 降雨</span><span className="text-slate-300 text-xs font-bold">☁️ {weather ? `${weather.cloudCover}% / ${weather.precipitation}%` : "40% / 10%"}</span></div>
                 <div className="flex flex-col"><span className="text-slate-500 text-[9px]">風向風速</span><span className="text-emerald-400 text-xs font-bold">🚩 {weather ? `${weather.windDirection} ${weather.windSpeed} km/h` : "E 15 km/h"}</span></div>
                 <div className="flex flex-col"><span className="text-slate-500 text-[9px]">紫外線</span><span className="text-yellow-500 text-xs font-bold">{weather ? `指數 (${weather.uvIndex})` : "中等 (5)"}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
