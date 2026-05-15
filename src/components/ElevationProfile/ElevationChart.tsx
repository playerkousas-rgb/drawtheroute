import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker } from '../../types';
import { formatTime } from '../../hooks/useTerrainAnalysis';

interface Props {
  profile: ElevationProfilePoint[];
  stats: RouteStats;
  waypoints: WaypointMarker[];
  onHoverPoint: (p: ElevationProfilePoint | null) => void;
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

export default function ElevationChart({ profile, stats, waypoints, onHoverPoint }: Props) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  
  // 新增：控制高度的 State，原本是 boolean，現在改用來控制 CSS 高度
  const [isExpanded, setIsExpanded] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null); 

  const onHoverRef = useRef(onHoverPoint);
  onHoverRef.current = onHoverPoint;

  // ─── 在這裡加入下載功能 ──────────────────────────────────────
const handleDownload = () => {
    const svg = document.querySelector('.recharts-surface');
    if (!svg) return;

    // ─── 新增：手動補回丟失的線條樣式 ───
    const gridLines = svg.querySelectorAll('.recharts-cartesian-grid-horizontal line');
    gridLines.forEach((line) => {
      (line as SVGElement).setAttribute('stroke', '#334155'); // 賦予深灰色
      (line as SVGElement).setAttribute('stroke-dasharray', '3 3'); // 賦予虛線樣式
      (line as SVGElement).setAttribute('opacity', '0.3'); // 賦予透明度
    });
    // ──────────────────────────────────────

    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `profile-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };
  // ────────────────────────────────────────────────────────────
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
        label: isSP ? 'SP' : (isEP ? 'EP' : `CP${idx}`),
        color: isSP ? '#10b981' : (isEP ? '#f87171' : '#fbbf24')
      };
    });
  }, [profile, waypoints]);

  const onMove = useCallback((e: any) => {
    if (e?.activePayload?.[0]) {
      const pt = e.activePayload[0].payload as ElevationProfilePoint;
      setHoverX(pt.distance);
      onHoverRef.current(pt);
    }
  }, []);

  const onLeave = useCallback(() => {
    setHoverX(null);
    onHoverRef.current(null);
  }, []);

  if (!profile.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-4xl opacity-15">🏔️</div>
        <p className="text-slate-500 text-sm">點擊地圖上任意兩點開始規劃山徑</p>
      </div>
    );
  }

  const elevs = profile.map(p => Number(p.elevation)).filter(e => !isNaN(e));
  const maxE = elevs.length > 0 ? Math.max(...elevs) : 100;
  const roundedMax = Math.ceil(maxE / 100) * 100;
  const finalMax = (roundedMax - maxE < 30) ? roundedMax + 100 : roundedMax;
  const yDomain: [number, number] = [0, finalMax];

  return (
    /* 這裡用了動態高度：isExpanded 為真時佔螢幕 70% 高度，否則保持原本高度 */
    <div 
      ref={chartRef} 
      className={`flex flex-col bg-slate-950 transition-all duration-300 border-t border-slate-800 ${
        isExpanded ? 'h-[70vh]' : 'h-full'
      }`}
    >
      
      <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800 bg-slate-900/30">
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('chart')} className={`px-3 py-1 text-xs rounded ${activeTab === 'chart' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>剖面圖</button>
          <button onClick={() => setActiveTab('table')} className={`px-3 py-1 text-xs rounded ${activeTab === 'table' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>路程表</button>
        </div>
        
        <div className="flex gap-4 items-center">
          {/* 下載與導出組 */}
          <div className="flex gap-3 items-center">
            <button onClick={handleDownload} className="text-slate-400 hover:text-white text-xs">
              💾 PNG (SVG)
            </button>
            <button 
              onClick={() => alert('路程表導出框架已就緒')} 
              className="text-blue-400 hover:text-blue-300 text-xs font-medium border border-blue-900/30 px-2 py-0.5 rounded bg-blue-900/10"
            >
              📊 導出 Excel (CSV)
            </button>
          </div>

          {/* 展開拉高按鈕 */}
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className="text-blue-400 hover:text-blue-300 text-xs font-bold border border-blue-900/50 px-2 py-0.5 rounded bg-blue-950/30"
          >
            {isExpanded ? '🔽 縮小面板' : '🔼 展開拉高'}
          </button>
        </div>
      </div>

     {activeTab === 'table' && (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse text-[12px] border border-slate-700">
      {/* 🔴 紅色區域：寫死表頭 (Static Headers) */}
      <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
        <tr>
          <th rowSpan={2} className="border border-slate-700 p-2">檢查站</th>
          <th className="border border-slate-700 p-2">地名</th>
          <th className="border border-slate-700 p-2">網格座標</th>
          <th rowSpan={2} className="border border-slate-700 p-2">前視<br/>方位</th>
          <th className="border border-slate-700 p-2">分段距離</th>
          <th className="border border-slate-700 p-2">累積上升</th>
          <th className="border border-slate-700 p-2">路段需時</th>
          <th colSpan={2} className="border border-slate-700 p-2">預計時間</th>
          <th rowSpan={2} className="border border-slate-700 p-2">備註/工務</th>
        </tr>
        <tr>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">地理特徵</th>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">高度(m)</th>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">(公里)</th>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">(公尺)</th>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">(分鐘)</th>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">出發</th>
          <th className="border border-slate-700 p-1 font-normal text-slate-500">到達</th>
        </tr>
      </thead>

      <tbody>
        {waypoints.map((wp, i) => (
          <tr key={i} className="border-b border-slate-800">
            {/* 🔴 紅色：標籤 */}
            <td className="p-2 text-center font-bold text-red-500 bg-red-500/5">
              {i === 0 ? 'SP' : (i === waypoints.length - 1 ? 'EP' : `CP${i}`)}
            </td>

            {/* ⚪ 白色：手動填寫區 (暫以 Input 示意) */}
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 outline-none text-white focus:bg-blue-500/20" placeholder="填寫特徵..." />
            </td>

            {/* 🟣 紫色：系統變量 (對接點位數據) */}
            <td className="p-2 border border-slate-700 text-purple-400 font-mono">
              {wp.latlng.lat.toFixed(3)}, {wp.latlng.lng.toFixed(3)}
            </td>

            {/* ⚪ 白色：前視方位 */}
            <td className="p-0 border border-slate-700 bg-white/5 w-12">
              <input className="w-full bg-transparent p-2 text-center outline-none" placeholder="0°" />
            </td>

            {/* 🟣 紫色：距離/上升/需時 (這裡之後接計算邏輯) */}
            <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">0.0</td>
            <td className="p-2 border border-slate-700 text-center text-purple-300">+0</td>
            <td className="p-2 border border-slate-700 text-center text-purple-400">0</td>

            {/* ⚪ 白色：預計出發 (手動) */}
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 text-center outline-none" defaultValue={i === 0 ? "08:00" : ""} />
            </td>
            {/* 🟣 紫色：預計到達 (自動計算) */}
            <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">--:--</td>

            {/* ⚪ 白色：備註 */}
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 outline-none" placeholder="領航/工務..." />
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    {/* 🟣 紫色：底部環境自動數據區 */}
    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-purple-900/30">
      <div className="flex flex-col">
        <span className="text-red-400 text-[10px] uppercase font-bold">太陽 (Sun)</span>
        <span className="text-purple-400 text-sm">🌅 06:14 / 🌇 18:39</span>
      </div>
      <div className="flex flex-col">
        <span className="text-red-400 text-[10px] uppercase font-bold">月亮 (Moon)</span>
        <span className="text-purple-400 text-sm">🌙 20:41 / 🌑 01:31</span>
      </div>
      <div className="flex flex-col">
        <span className="text-red-400 text-[10px] uppercase font-bold">月相 (Phase)</span>
        <span className="text-purple-400 text-sm">🌓 上弦月 (52%)</span>
      </div>
      <div className="flex flex-col border-l border-slate-700 pl-4">
        <span className="text-red-400 text-[10px] uppercase font-bold">潮汐預測 (Tides)</span>
        <span className="text-purple-300 text-[11px]">🌊 10:25 (2.1m) | 16:44 (0.7m)</span>
      </div>
    </div>
  </div>
)}

// 確保 StatBadge 函數是在 ElevationChart 括號之外定義的
function StatBadge({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 4,
      background: 'rgba(15,23,42,0.7)',
      border: '1px solid rgba(148,163,184,0.12)',
      borderRadius: 6, padding: '3px 8px',
    }}>
      <span style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ color, fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{val}</span>
    </div>
  );
}
