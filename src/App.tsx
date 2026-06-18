import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown } from 'lucide-react';
import MapCore from './components/Map/MapCore';
import ElevationChart from './components/ElevationProfile/ElevationChart';
import LeftToolbar from './components/Toolbar/LeftToolbar';
import RightPanel from './components/RightPanel/RightPanel';
import { useRouteManager } from './hooks/useRouteManager';
import { useTerrainAnalysis } from './hooks/useTerrainAnalysis';
import { useItineraryData } from './hooks/useItineraryData';
import { exportGPX } from './lib/gpxExport';
import { saveAs } from 'file-saver';
import { LatLng, MapLayer, NaismithSettings, ElevationProfilePoint } from './types';
import { hk80ToWgs84, wgs84ToHk80, formatToHk80Shorthand } from './utils/coordUtils';



const DEFAULT_NAISMITH: NaismithSettings = { baseSpeedKmh: 3.5, ascentPer20m: 7, descentPer20m: 2 };

export default function App() {
  const [mapLayer, setMapLayer]       = useState<MapLayer>('topo');
  const [naismith, setNaismith]       = useState<NaismithSettings>(DEFAULT_NAISMITH);
  const [profileOpen, setProfileOpen] = useState(true);

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
    isProcessing, lastError,
    addWaypoint, deleteWaypoint, undoLastSegment, clearAll, importGPX,
  } = useRouteManager();

  const { stats, elevationProfile, analyzedSegments } = useTerrainAnalysis(segments, naismith);
  const { materials } = useItineraryData(waypoints, segments, selectedDate);

  const handlePointClick = useCallback((pt: ElevationProfilePoint) => {
    setSearchLocation({ lat: pt.lat, lng: pt.lng });
  }, []);

  const handleMapClick = useCallback((latlng: LatLng) => {
    if (isProcessing) return;
    addWaypoint(latlng);
  }, [isProcessing, addWaypoint]);

  const goToLocation = useCallback(async (input: string, mode: 'utm' | 'hk80' | 'latlng') => {
    const cleanInput = input.trim();
    if (!cleanInput) return;

    try {
      if (mode === 'utm') {
        const normalizedInput = cleanInput.toUpperCase().replace(/\s+/g, ' ');
        
        // 1. 🚀 絕對優先：匹配路程表
        if (materials && materials.length > 0) {
          const matchIdx = materials.findIndex((m: any) => 
            m.grid?.toUpperCase().replace(/\s+/g, ' ') === normalizedInput
          );
          if (matchIdx !== -1 && waypoints[matchIdx]) {
            setSearchLocation(waypoints[matchIdx].latlng);
            return;
          }
        }

        // 2. 專業坐標解析 (支持: "50Q KK 0670 2346", "KK 0670 2346", 或 "0670 2346")
        const utmMatch = cleanInput.match(/^([45]0[PQ])?\s*([A-Z]{2})?\s*(\d{4})\s*(\d{4})$/i);
        if (utmMatch) {
          const zone = utmMatch[1]?.toUpperCase(); // e.g. 50Q
          let square = utmMatch[2]?.toUpperCase(); // e.g. KK
          const rawE = utmMatch[3];
          const rawN = utmMatch[4];
          
          // 如果沒有方格碼，嘗試從現有路點中智能推斷方格碼
          if (!square && waypoints.length > 0) {
            const sampleWp = waypoints[0];
            const sampleHk80 = wgs84ToHk80(sampleWp.latlng.lat, sampleWp.latlng.lng);
            const sampleShorthand = formatToHk80Shorthand(sampleHk80.easting, sampleHk80.northing);
            square = sampleShorthand.split(' ')[0];
          }

          if (square) {
            const squareMap: Record<string, [string, string]> = {
              'KK': ['83', '82'], 'JK': ['83', '81'], 'HE': ['81', '82'], 'GE': ['81', '81'],
              'LK': ['84', '82'], 'MK': ['84', '81'], 'KE': ['82', '82'], 'JE': ['82', '81'],
              'FK': ['80', '82'], 'GK': ['80', '81'], 'FE': ['80', '82'], 
              'AK': ['79', '82'], 'BK': ['79', '81'],
            };
            const prefix = squareMap[square];
            if (prefix) {
              const easting = parseInt(`${prefix[0]}${rawE}`, 10);
              const northing = parseInt(`${prefix[1]}${rawN}`, 10);
              const coords = hk80ToWgs84(northing, easting);
              setSearchLocation(coords);
              return;
            }
            throw new Error(`無法辨識方格碼 "${square}"。`);
          }
          throw new Error('請提供方格碼 (例如: KK 0670 2346) 以精確定位。');
        }
        throw new Error('UTM 格式不正確。請使用: 50Q KK 0670 2346');
      }

      if (mode === 'hk80') {
        const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
        if (parts.length === 2) {
          const easting = parseFloat(parts[0]);
          const northing = parseFloat(parts[1]);
          if (!isNaN(easting) && !isNaN(northing)) {
            const coords = hk80ToWgs84(northing, easting);
            setSearchLocation(coords);
            return;
          }
        }
        throw new Error('HK80 格式不正確。請使用: 830670 82346');
      }

      if (mode === 'latlng') {
        const parts = cleanInput.split(/[\s,]+/).filter(Boolean);
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lng = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            setSearchLocation({ lat, lng });
            return;
          }
        }
        throw new Error('經緯度格式不正確。請使用: 22.3, 114.1');
      }
    } catch (e: any) {
      alert(e.message || 'Invalid coordinates');
    }
  }, [materials, waypoints]);

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
        isProcessing={isProcessing}
        searchLocation={searchLocation}
        onSearchCleared={() => setSearchLocation(null)}
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
        onSearchCoord={goToLocation}
      />

      {/* ── Right info panel ── */}
      <RightPanel
        stats={stats}
        segments={analyzedSegments}
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
            />
          </div>
        </div>

        {/* Footer info */}
        {!isExpanded && (
          <div className="text-center pb-1 pointer-events-none">
            <p className="text-[9px] font-mono tracking-widest" style={{ color: 'rgba(100,116,139,0.4)' }}>
              Copyright 2026 SKWSCOUT. ALL RIGHTS RESERVED.
            </p>
          </div>
        )}
      </motion.div>

      <input ref={fileRef} type="file" accept=".gpx" className="hidden" onChange={handleGPXFile} />
    </div>
  );
}

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
