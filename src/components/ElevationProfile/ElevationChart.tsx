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

      {activeTab === 'chart' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-1.5 px-4 pt-2 pb-1.5 flex-wrap">
            <StatBadge label="總距離" val={`${stats.totalDistance.toFixed(2)} km`} color="#60a5fa" />
            <StatBadge label="總爬升" val={`+${stats.totalAscent.toFixed(0)} m`} color="#34d399" />
            <StatBadge label="總下降" val={`-${stats.totalDescent.toFixed(0)} m`} color="#f87171" />
            <StatBadge label="最高" val={`${stats.maxElevation.toFixed(0)} m`} color="#fbbf24" />
            <StatBadge label="最低" val={`${stats.minElevation.toFixed(0)} m`} color="#22d3ee" />
            <StatBadge label="預計時間" val={formatTime(stats.estimatedTime)} color="#a78bfa" />
          </div>

          <div className="flex-1 min-h-0 px-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={profile} margin={{ top: 20, right: 16, left: 0, bottom: 4 }} onMouseMove={onMove} onMouseLeave={onLeave}>
                <defs>
                  <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="distance" type="number" scale="linear" domain={['dataMin', 'dataMax']} tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `${Number(v).toFixed(1)}km`} axisLine={{ stroke: 'rgba(148,163,184,0.15)' }} tickLine={false} minTickGap={40} />
                <YAxis dataKey="elevation" domain={yDomain} ticks={[0, 200, 400, 600, 800, 1000].filter(t => t <= yDomain[1])} tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `${v}m`} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<CustomTooltip />} cursor={false} />
                {markers.map((m, i) => (
                  <ReferenceLine key={i} x={m.x} stroke={m.color} strokeWidth={1.5} strokeDasharray="3 3" label={{ value: m.label, position: 'top', fill: m.color, fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace', dy: -5 }} />
                ))}
                {hoverX !== null && <ReferenceLine x={hoverX} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4 3" />}
                <Area type="monotone" dataKey="elevation" stroke="#60a5fa" strokeWidth={2} fill="url(#elev-grad)" dot={false} activeDot={{ r: 5, fill: '#60a5fa', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
      <div className="flex-1 overflow-auto bg-[#0a0f1e] p-4 custom-scrollbar">
          <table className="w-full text-[11px] font-mono border-collapse border border-slate-700">
            <thead className="bg-slate-900 sticky top-0 z-20">
              <tr className="text-slate-400">
                <th className="border border-slate-700 p-1" rowSpan={2}>檢查站</th>
                <th className="border border-slate-700 p-1" colSpan={2}>地點 / 座標</th>
                <th className="border border-slate-700 p-1" colSpan={2}>里程 (km)</th>
                <th className="border border-slate-700 p-1" colSpan={2}>垂直變化 (m)</th>
                <th className="border border-slate-700 p-1" colSpan={2}>Naismith 需時</th>
                <th className="border border-slate-700 p-1" rowSpan={2}>備註</th>
              </tr>
              <tr className="text-slate-500 bg-slate-900/50">
                <th className="border border-slate-700 p-1 font-normal text-[10px]">名稱</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">網格座標</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">分段</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">累計</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">上升</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">下降</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">段需時</th>
                <th className="border border-slate-700 p-1 font-normal text-[10px]">預計到站</th>
              </tr>
            </thead>
          <tbody className="text-slate-300">
  {waypoints.map((wp, i) => (
    <tr key={i} className="hover:bg-slate-800/30 transition-colors">
      {/* 檢查站 */}
      <td className="border border-slate-700 p-2 text-center font-bold text-blue-400 uppercase">
        {i === 0 ? 'SP' : (i === waypoints.length - 1 ? 'EP' : `CP${i}`)}
      </td>
      
      {/* 地點名稱：這裡我們寫死文字，或是用 i，避開變數報錯 */}
      <td className="border border-slate-700 p-2 min-w-[120px]">
        {`檢查站 ${i}`} 
      </td>
      
      {/* 網格座標：使用原本就有的 latlng */}
      <td className="border border-slate-700 p-2 text-[10px] text-slate-500">
        {wp.latlng.lat.toFixed(4)}, {wp.latlng.lng.toFixed(4)}
      </td>
      
      {/* 以下全部維持原樣的 0.00 框架 */}
      <td className="border border-slate-700 p-2 text-center text-emerald-400">0.00</td>
      <td className="border border-slate-700 p-2 text-center">0.00</td>
      <td className="border border-slate-700 p-2 text-center text-rose-400">+0</td>
      <td className="border border-slate-700 p-2 text-center text-emerald-500">-0</td>
      <td className="border border-slate-700 p-2 text-center text-yellow-400">00</td>
      <td className="border border-slate-700 p-2 text-center font-bold text-white">--:--</td>
      <td className="border border-slate-700 p-2 italic text-slate-600">...</td>
    </tr>
  ))}
</tbody>
     </table>
        </div>
      )}
    </div>
  );
}

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
