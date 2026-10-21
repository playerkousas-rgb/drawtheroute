import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import MapCore, { MapMode } from './components/Map/MapCore';
import ElevationChart from './components/ElevationProfile/ElevationChart';
import LeftToolbar from './components/Toolbar/LeftToolbar';
import RightPanel from './components/RightPanel/RightPanel';
import { useRouteManager } from './hooks/useRouteManager';
import { useTerrainAnalysis } from './hooks/useTerrainAnalysis';
import { useCpSlide } from './hooks/useCpSlide';
import { useItineraryData } from './hooks/useItineraryData';
import { exportGPX } from './lib/gpxExport';
import { saveAs } from 'file-saver';
import { LatLng, MapLayer, NaismithSettings, ElevationProfilePoint } from './types';
import { convertToWgs84 } from './services/geodeticService';
import ConfirmProvider from './components/Confirm/ConfirmProvider';
import { useConfirm, kv } from './components/Confirm/confirmShared';
import MapExportDialog from './components/Export/MapExportDialog';
import type { Map as LeafletMap } from 'leaflet';



const DEFAULT_NAISMITH: NaismithSettings = { baseSpeedKmh: 3.5, ascentPer20m: 7, descentPer20m: 2 };

export default function App() {
  return (
    <ConfirmProvider>
      <AppInner />
    </ConfirmProvider>
  );
}

function AppInner() {
  const { confirm } = useConfirm();
  const [mapLayer, setMapLayer]       = useState<MapLayer>('topo');
  const [naismith, setNaismith]       = useState<NaismithSettings>(DEFAULT_NAISMITH);
  const [hoveredPt, setHoveredPt] = useState<ElevationProfilePoint | null>(null);
  const [cursorDistance, setCursorDistance] = useState<number | undefined>(undefined);
  const [profileOpen, setProfileOpen] = useState(true);
  /** 路線連地圖圖片匯出（紙圖化） */
  const [exportMapOpen, setExportMapOpen] = useState(false);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);

  const [isExpanded, setIsExpanded] = useState(false);
  const [searchLocation, setSearchLocation] = useState<LatLng | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    segments, waypoints,
    routingMode, setRoutingMode,
    isProcessing, lastError, progress,
    addWaypoint, deleteWaypoint, undoLastSegment, clearAll, importGPX,
    moveWaypoint, slideWaypointBackward, insertVia, moveVia, deleteVia, insertViaNear,
    addDrawnStroke,
  } = useRouteManager();

  // ── 手繪 / 微調模式 ─────────────────────────────────────────────────
  const [mapMode, setMapMode] = useState<MapMode>('idle');
  const [magnet, setMagnet] = useState(true);
  const [magnetGapM, setMagnetGapM] = useState(250);

  // ── CP 位置編輯（地圖拖曳 / 橫切面拖曳 / 路程表改座標） ─────────────────
  const [draggingWp, setDraggingWp] = useState<number | null>(null);
  const [highlightWp, setHighlightWp] = useState<number | null>(null);

  useEffect(() => {
    if (segments.length > 0 && cursorDistance === undefined) {
      setCursorDistance(0);
    } else if (segments.length === 0) {
      setCursorDistance(undefined);
    }
  }, [segments.length, cursorDistance]);

  const { stats, elevationProfile, analyzedSegments } = useTerrainAnalysis(segments, naismith);
  const { materials } = useItineraryData(waypoints, segments, selectedDate);

  // ══════════════════════════════════════════════════════════════════════
  //  CP 位置編輯：把目標點「沿實際路線」平移，唔會拉直路線
  //   • 沿出程滑動 → 直接移動 CP，出程由新位置重新貼路
  //   • 沿入程後退 → 先插入新 CP 再刪舊 CP（保留入程原線，即原地併段）
  //   • 離路線太遠（> 400m）→ 直接自由移動
  // ══════════════════════════════════════════════════════════════════════
  const cpSlide = useCpSlide(waypoints, segments, {
    onMove: moveWaypoint,
    onBacktrack: slideWaypointBackward,
  });

  const handleCpMoveToLatLng = useCallback((index: number, latlng: LatLng) => {
    void cpSlide.slide(index, latlng);
    return true;
  }, [cpSlide]);

  /** 橫切面拖曳：以里程（km）定位 → 取剖面上最近的一點做目標 */
  const handleCpMoveToDistance = useCallback((index: number, distanceKm: number) => {
    if (!elevationProfile.length) return;
    let best = elevationProfile[0];
    let bestD = Math.abs(best.distance - distanceKm);
    for (const p of elevationProfile) {
      const d = Math.abs(p.distance - distanceKm);
      if (d < bestD) { bestD = d; best = p; }
    }
    handleCpMoveToLatLng(index, { lat: best.lat, lng: best.lng });
  }, [elevationProfile, handleCpMoveToLatLng]);

  /** 路程表直接改座標 */
  const handleSetWaypoint = useCallback((index: number, latlng: LatLng) => {
    handleCpMoveToLatLng(index, latlng);
  }, [handleCpMoveToLatLng]);

  /** 拖曳開始／結束：地圖手柄、橫切面手柄、右側面板共用同一個高亮狀態 */
  const handleWaypointDragState = useCallback((index: number | null) => {
    setDraggingWp(index);
  }, []);

  const handlePointClick = useCallback((pt: ElevationProfilePoint) => {
    setSearchLocation({ lat: pt.lat, lng: pt.lng });
    setCursorDistance(pt.distance);
  }, []);

  const handleCursorMove = useCallback((distance: number, point: LatLng) => {
    setCursorDistance(distance);
    // Also update hovered point for the chart
    const profile = elevationProfile;
    if (profile.length > 0) {
      // Find closest point in profile to this distance
      let closest = profile[0];
      let minDiff = Math.abs(profile[0].distance - distance);
      for (const p of profile) {
        const diff = Math.abs(p.distance - distance);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }
      setHoveredPt(closest);
    }
  }, [elevationProfile]);

  const handleMapClick = useCallback((latlng: LatLng) => {
    if (isProcessing) return;
    addWaypoint(latlng);
  }, [isProcessing, addWaypoint]);

  // ── 手繪完成 → 磁石貼路 / 保留手繪原線 ───────────────────────────────
  const handleDrawStroke = useCallback(async (points: LatLng[]) => {
    if (points.length < 2) return;
    await addDrawnStroke(points, magnet, magnetGapM);
  }, [addDrawnStroke, magnet, magnetGapM]);

  // ── 微調：點擊路線即加一個彎位 ─────────────────────────────────────
  const handleEditClick = useCallback((latlng: LatLng, toleranceM: number) => {
    if (isProcessing) return;
    void insertViaNear(latlng, toleranceM);
  }, [isProcessing, insertViaNear]);

  // ── 模式切換（手繪 / 微調互斥；Esc 返回一般模式） ─────────────────────
  const toggleMode = useCallback((next: MapMode) => {
    const entering = mapMode !== next;
    setMapMode(entering ? next : 'idle');
    // 手繪時收起底部資料面板，讓出多點地圖空間
    if (entering && next === 'draw') setProfileOpen(false);
  }, [mapMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMapMode('idle');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goToLocation = useCallback(async (input: string, mode: 'utm' | 'hk80' | 'latlng', utmOptions?: { zone: string; square: string }) => {
    const cleanInput = input.trim();
    if (!cleanInput) return;

    try {
      const coords = await convertToWgs84(cleanInput, mode, utmOptions);
      setSearchLocation(coords);
    } catch (e: any) {
      alert(e.message || 'Invalid coordinates');
    }
  }, []);

  const handleExportGPX = useCallback(() => {
    if (!segments.length) return;
    const pts = segments.flatMap(s =>
      s.points.map(p => ({ lat: p.lat, lng: p.lng, elevation: p.elevation }))
    );
    // 寫入 waypoints（起點 / CP / 終點）以保留檢查點結構
    const wps = waypoints.map(w => ({ lat: w.latlng.lat, lng: w.latlng.lng, elevation: w.elevation }));
    saveAs(
      new Blob([exportGPX(pts, 'ReliefForge 山徑路線', wps)], { type: 'application/gpx+xml' }),
      `reliefforge-${Date.now()}.gpx`
    );
  }, [segments, waypoints]);

  const hasRoute = segments.length > 0 || waypoints.length > 0;

  const handleGPXFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';

    // 防呆：已有路線時，匯入會覆蓋現有路線，先確認
    if (hasRoute) {
      const ok = await confirm({
        title: '匯入 GPX 將覆蓋現有路線',
        message: kv([
          ['現有路點', `${waypoints.length} 個`],
          ['現有路段', `${segments.length} 段`],
          ['匯入檔案', f.name],
        ]),
        confirmLabel: '覆蓋並匯入',
        danger: true,
      });
      if (!ok) return;
    }

    const reader = new FileReader();
    reader.onload = ev => importGPX(ev.target?.result as string);
    reader.onerror = () => alert('檔案讀取失敗，請重試');
    reader.readAsText(f);
  }, [confirm, hasRoute, waypoints.length, segments.length, importGPX]);

  // ── 防呆：清除全部前先確認（不可逆） ──
  const handleClear = useCallback(async () => {
    const ok = await confirm({
      title: '確認清除全部路線？',
      message: kv([
        ['將刪除路點', `${waypoints.length} 個`],
        ['將刪除路段', `${segments.length} 段`],
      ]),
      confirmLabel: '清除全部',
      danger: true,
    });
    if (ok) clearAll();
  }, [confirm, waypoints.length, segments.length, clearAll]);

  // ── 防呆：刪除路點前先確認（不可逆） ──
  const handleDeleteWaypoint = useCallback(async (index: number) => {
    const wp = waypoints[index];
    const label = wp?.type === 'start' ? '起點' : wp?.type === 'end' ? '終點' : `CP ${index}`;
    const ok = await confirm({
      title: `確認刪除${label}？`,
      message: kv([
        ['路點', `${label}（${wp?.elevation.toFixed(0) ?? '?'} m）`],
        ['刪除後', '相關路段會重新計算'],
      ]),
      confirmLabel: '刪除',
      danger: true,
    });
    if (ok) deleteWaypoint(index);
  }, [confirm, waypoints, deleteWaypoint]);

  return (
    <div className="w-screen h-screen relative overflow-hidden" style={{ background: '#0a0f1e' }}>
  
     

      {/* ── Map ── */}
      <MapCore
        segments={segments}
        waypoints={waypoints}
        mapLayer={mapLayer}
        onRouteClick={handleMapClick}
        isProcessing={isProcessing}
        searchLocation={searchLocation}
        onSearchCleared={() => setSearchLocation(null)}
        profile={elevationProfile}
        externalDistance={cursorDistance}
        onCursorMove={handleCursorMove}
        mode={mapMode}
        onDrawStroke={handleDrawStroke}
        onMoveWaypoint={moveWaypoint}
        onInsertVia={insertVia}
        onMoveVia={moveVia}
        onDeleteVia={deleteVia}
        onDeleteWaypoint={handleDeleteWaypoint}
        onEditClick={handleEditClick}
        highlightWaypoint={draggingWp ?? highlightWp}
        onWaypointDragState={handleWaypointDragState}
        onMapReady={setMapInstance}
      />

      {/* ── Left toolbar ── */}
      <LeftToolbar
        routingMode={routingMode}
        onRoutingMode={setRoutingMode}
        mapLayer={mapLayer}
        onMapLayer={setMapLayer}
        onUndo={undoLastSegment}
        onClear={handleClear}
        onImportGPX={() => fileRef.current?.click()}
        onExportGPX={handleExportGPX}
        onExportMapImage={() => setExportMapOpen(true)}
        hasRoute={hasRoute}
        isProcessing={isProcessing}
        onSearchCoord={goToLocation}
        mode={mapMode}
        onMode={toggleMode}
        magnet={magnet}
        onMagnet={setMagnet}
        magnetGapM={magnetGapM}
        onMagnetGap={setMagnetGapM}
      />

      {/* ── Right info panel ── */}
      <RightPanel
        stats={stats}
        segments={analyzedSegments}
        waypoints={waypoints}
        onDeleteWaypoint={handleDeleteWaypoint}
        onHighlightWaypoint={setHighlightWp}
        highlightWaypoint={highlightWp}
        naismithSettings={naismith}
        onNaismithChange={setNaismith}
        isProcessing={isProcessing}
        error={lastError}
      />

      {/* ── Top-centre status badge ── */}
      <TopBadge
        routingMode={routingMode}
        isProcessing={isProcessing}
        waypointCount={waypoints.length}
        segmentCount={segments.length}
        mode={mapMode}
        progress={progress}
      />

      {/* ── 手繪／微調模式提示條 ── */}
      <ModeHint
        mode={mapMode}
        magnet={magnet}
        isProcessing={isProcessing}
        onExit={() => setMapMode('idle')}
      />

     {/* ── Bottom elevation profile ── */}
      <motion.div
        className={`absolute bottom-0 left-0 right-0 z-[900] pointer-events-none transition-all duration-300`}
        animate={{ y: profileOpen ? 0 : (isExpanded ? 0 : 182) }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      >
        <div
          className={`mb-3 overflow-hidden pointer-events-auto transition-all duration-300 ${
            isExpanded ? 'mx-0 rounded-t-2xl shadow-2xl' : 'mx-16 rounded-2xl'
          }`}
          style={{
            background: 'rgba(8,14,28,0.94)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(148,163,184,0.12)',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
            height: isExpanded ? '70vh' : 'auto'
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-2 border-b border-slate-700/40 cursor-pointer select-none"
            onClick={() => setProfileOpen(v => !v)}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 text-xs font-medium">計劃書資料</span>
              {elevationProfile.length > 0 && (
                <span className="text-slate-600 text-[10px] font-mono">
                  {elevationProfile.length} 點
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="text-blue-400 hover:text-blue-300 text-[10px] font-bold border border-blue-900/50 px-2 py-0.5 rounded bg-blue-950/30"
              >
                {isExpanded ? '🔽 縮小' : '🔼 展開'}
              </button>
              <button className="text-slate-500 hover:text-slate-300 transition-colors">
                {profileOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
          </div>

          {/* Chart Area */}
         <div className={isExpanded ? "h-[calc(70vh-42px)]" : "h-44"}>
            <ElevationChart
              profile={elevationProfile}
              stats={stats}
              waypoints={waypoints}
              segments={analyzedSegments} // 🟢 原本是 segments，請換成經由 Mapzen 修正後的 analyzedSegments！
              naismithSettings={naismith}
              onPointClick={handlePointClick}
              externalDistance={cursorDistance}
              onHoverPoint={setHoveredPt}
              onSlideWaypoint={handleCpMoveToDistance}
              onSetWaypoint={handleSetWaypoint}
              draggingWaypoint={draggingWp}
              onWaypointDragState={handleWaypointDragState}
            />
          </div>
        </div>

        {/* Footer info */}
        {!isExpanded && (
          <div className="text-center pb-1 pointer-events-none">
            <p className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(100,116,139,0.4)' }}>
              Copyright 2026 SCOUT SYSTEM. ALL RIGHTS RESERVED.
            </p>
          </div>
        )}
      </motion.div>

      <input ref={fileRef} type="file" accept=".gpx" className="hidden" onChange={handleGPXFile} />

      {/* 路線連地圖圖片下載（紙圖化） */}
      <MapExportDialog
        open={exportMapOpen}
        onClose={() => setExportMapOpen(false)}
        map={mapInstance}
        segments={segments}
        waypoints={waypoints}
        mapLayer={mapLayer}
      />
      <Analytics />
    </div>
  );
}

// ── Top status badge ──────────────────────────────────────────────────────
function TopBadge({ routingMode, isProcessing, waypointCount, segmentCount, mode, progress }: {
  routingMode: 'hiking' | 'straight';
  isProcessing: boolean;
  waypointCount: number;
  segmentCount: number;
  mode: MapMode;
  progress: string | null;
}) {
  const isHiking = routingMode === 'hiking';
  const label    = isHiking ? '🥾 山徑路由 (BRouter hiking-mountain)' : '📏 直線模式 (SRTM 高度)';
  const border   = isHiking ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.4)';
  const textCls  = isHiking ? 'text-emerald-300' : 'text-yellow-300';
  const dotCls   = isHiking ? 'bg-emerald-400'   : 'bg-yellow-400';

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[900] flex flex-col items-center gap-2 pointer-events-none">
      <div
        className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium ${textCls}`}
        style={{ background: 'rgba(8,14,28,0.92)', backdropFilter: 'blur(16px)', border: `1px solid ${border}` }}
      >
        <div className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
        {label}
        {waypointCount > 0 && (
          <span className="text-slate-500 ml-1">
            · {waypointCount} 路點 / {segmentCount} 路段
          </span>
        )}
      </div>

      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{ background: 'rgba(8,14,28,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(52,211,153,0.3)' }}
          >
            <div className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }}
                />
              ))}
            </div>
            <span className="text-emerald-300">
              {progress ?? (mode === 'draw' ? '手繪處理中…' : '計算山徑路線中…')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 手繪 / 微調模式提示條 ──────────────────────────────────────────────────
function ModeHint({ mode, magnet, isProcessing, onExit }: {
  mode: MapMode;
  magnet: boolean;
  isProcessing: boolean;
  onExit: () => void;
}) {
  if (mode === 'idle') return null;
  const isDraw = mode === 'draw';
  const accent = isDraw ? 'rgba(167,139,250,0.55)' : 'rgba(96,165,250,0.55)';
  const dotCls = isDraw ? 'bg-violet-400' : 'bg-blue-400';
  const title = isDraw ? '✏️ 手繪模式' : '🖐️ 微調模式';
  const body = isDraw
    ? (magnet
        ? '按住並拖曳畫線 → 放手自動貼上實體山徑（磁石）'
        : '按住並拖曳畫線 → 放手保留親手畫的原線（磁石關閉）')
    : '拖曳手柄移動路點／彎位 · 拖「+」加彎位 · 點擊路線亦可加彎位 · 按 ✕ 刪除';

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3.5 py-2 rounded-xl text-[11px]"
      style={{
        background: 'rgba(8,14,28,0.94)',
        backdropFilter: 'blur(18px)',
        border: `1px solid ${accent}`,
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
        maxWidth: 'min(92vw, 560px)',
      }}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${dotCls} animate-pulse flex-shrink-0`} />
      <div className="flex flex-col leading-snug">
        <span className="text-slate-200 font-semibold">{title}</span>
        <span className="text-slate-400">{body}{isProcessing ? '（處理中…）' : ''}</span>
      </div>
      <button
        onClick={onExit}
        className="ml-1 text-[10px] px-2 py-0.5 rounded-md border border-slate-600/60 text-slate-300 hover:bg-slate-700/50 transition-colors flex-shrink-0"
        title="返回一般模式（Esc）"
      >
        完成
      </button>
    </motion.div>
  );
}
