import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown } from 'lucide-react';
import MapCore from './components/Map/MapCore';
import ElevationChart from './components/ElevationProfile/ElevationChart';
import LeftToolbar from './components/Toolbar/LeftToolbar';
import RightPanel from './components/RightPanel/RightPanel';
import { useRouteManager } from './hooks/useRouteManager';
import { useTerrainAnalysis } from './hooks/useTerrainAnalysis';
import { exportGPX } from './lib/gpxExport';
import { saveAs } from 'file-saver';
import { LatLng, MapLayer, NaismithSettings, ElevationProfilePoint } from './types';

const DEFAULT_NAISMITH: NaismithSettings = { baseSpeedKmh: 3.5, ascentPer20m: 7, descentPer20m: 2 };

export default function App() {
  const [mapLayer, setMapLayer]       = useState<MapLayer>('topo');
  const [naismith, setNaismith]       = useState<NaismithSettings>(DEFAULT_NAISMITH);
  const [hoveredPt, setHoveredPt]     = useState<ElevationProfilePoint | null>(null);
  const [profileOpen, setProfileOpen] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    segments, waypoints,
    routingMode, setRoutingMode,
    isProcessing, lastError,
    addWaypoint, deleteWaypoint, undoLastSegment, clearAll, importGPX,
  } = useRouteManager();

  const { stats, elevationProfile } = useTerrainAnalysis(segments, naismith);

  const handleMapClick = useCallback((latlng: LatLng) => {
    if (isProcessing) return;
    addWaypoint(latlng);
  }, [isProcessing, addWaypoint]);

  const handleExportGPX = useCallback(() => {
    if (!segments.length) return;
    const pts = segments.flatMap(s =>
      s.points.map(p => ({ lat: p.lat, lng: p.lng, elevation: p.elevation }))
    );
    saveAs(
      new Blob([exportGPX(pts, 'ReliefForge 山徑路線')], { type: 'application/gpx+xml' }),
      `reliefforge-${Date.now()}.gpx`
    );
  }, [segments]);

  const handleGPXFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => importGPX(ev.target?.result as string);
    reader.readAsText(f);
    e.target.value = '';
  }, [importGPX]);

  const hasRoute = segments.length > 0 || waypoints.length > 0;

  return (
    <div className="w-screen h-screen relative overflow-hidden" style={{ background: '#0a0f1e' }}>

      {/* ── Map ── */}
      <MapCore
        segments={segments}
        waypoints={waypoints}
        mapLayer={mapLayer}
        onRouteClick={handleMapClick}
        hoveredPoint={hoveredPt}
        isProcessing={isProcessing}
      />

      {/* ── Left toolbar ── */}
      <LeftToolbar
        routingMode={routingMode}
        onRoutingMode={setRoutingMode}
        mapLayer={mapLayer}
        onMapLayer={setMapLayer}
        onUndo={undoLastSegment}
        onClear={clearAll}
        onImportGPX={() => fileRef.current?.click()}
        onExportGPX={handleExportGPX}
        hasRoute={hasRoute}
        isProcessing={isProcessing}
      />

      {/* ── Right info panel ── */}
      <RightPanel
        stats={stats}
        segments={segments}
        waypoints={waypoints}
        onDeleteWaypoint={deleteWaypoint}
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
      />

     {/* ── Bottom elevation profile ── */}
      <motion.div
        /* A: 這裡控制外層容器的定位。展開時左右貼齊 (left-0 right-0)，縮小時保持邊距 (mx-16) */
        className={`absolute bottom-0 z-[900] pointer-events-none transition-all duration-300 ${
          isExpanded ? 'left-0 right-0' : 'left-0 right-0' 
        }`}
        /* y 軸動畫保留原本的收合邏輯 */
        animate={{ y: profileOpen ? 0 : (isExpanded ? 500 : 182) }} 
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      >
        <div
          /* 這裡動態切換圓角和邊距：展開時不留邊距 (mx-0)，高度變成 70vh */
          className={`mb-3 overflow-hidden pointer-events-auto transition-all duration-300 ${
            isExpanded ? 'mx-0 rounded-t-3xl shadow-2xl' : 'mx-16 rounded-2xl'
          }`}
          style={{
            background: 'rgba(8,14,28,0.96)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(148,163,184,0.15)',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
            height: isExpanded ? '70vh' : 'auto' // B: 你的理論核心，這裡直接撐高容器
          }}
        >
          {/* 標題與控制列 */}
          <div
            className="flex items-center justify-between px-6 py-2.5 border-b border-slate-700/40 cursor-pointer select-none bg-slate-900/40"
            onClick={() => setProfileOpen(v => !v)}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 text-xs font-medium">海拔剖面圖</span>
              {elevationProfile.length > 0 && (
                <span className="text-slate-500 text-[10px] font-mono">
                  {elevationProfile.length} 點
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
              {/* 控制高度的按鈕 */}
              <button 
                onClick={(e) => {
                  e.stopPropagation(); // 防止點擊按鈕時觸發縮折疊
                  setIsExpanded(!isExpanded);
                }}
                className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 text-[10px] px-2 py-0.5 rounded border border-blue-500/30 transition-colors"
              >
                {isExpanded ? '🔽 縮小面板' : '🔼 展開拉高'}
              </button>
              
              <button className="text-slate-500 hover:text-slate-300 transition-colors">
                {profileOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
          </div>

          {/* 圖表容器：如果是展開狀態，高度自動扣掉標題列高度 */}
          <div className={isExpanded ? "h-[calc(70vh-45px)]" : "h-44"}>
            <ElevationChart
              profile={elevationProfile}
              stats={stats}
              waypoints={waypoints}
              onHoverPoint={setHoveredPt}
            />
          </div>
        </div>

        {/* 版權字樣 */}
        <div className={`text-center pb-1 pointer-events-none ${isExpanded ? 'hidden' : 'block'}`}>
          <p className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(100,116,139,0.4)' }}>
            Copyright 2026 SKWSCOUT. ALL RIGHTS RESERVED.
          </p>
        </div>
      </motion.div>

// ── Top status badge ──────────────────────────────────────────────────────
function TopBadge({ routingMode, isProcessing, waypointCount, segmentCount }: {
  routingMode: 'hiking' | 'straight';
  isProcessing: boolean;
  waypointCount: number;
  segmentCount: number;
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
            <span className="text-emerald-300">計算山徑路線中…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
