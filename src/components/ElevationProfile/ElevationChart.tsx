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
    <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('chart')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'chart' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              高度剖面
            </button>
            <button
              onClick={() => setActiveTab('table')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'table' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              路程計畫表
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <StatBadge label="Distance" val="--" color="#3b82f6" />
          <StatBadge label="Ascent" val="--" color="#10b981" />
          <StatBadge label="Descent" val="--" color="#ef4444" />
        </div>
      </div>

      {activeTab === 'chart' ? (
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={profile} onMouseMove={() => {}} onMouseLeave={() => {}}>
              <defs>
                <linearGradient id="colorElevation" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis 
                dataKey="distance" 
                tickFormatter={(val) => `${(val / 1000).toFixed(1)}k`}
                stroke="#64748b" fontSize={10} tickLine={false} axisLine={false}
              />
              <YAxis 
                stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} unit="m"
              />
              <Area
                type="monotone" dataKey="elevation" stroke="#3b82f6" strokeWidth={2}
                fillOpacity={1} fill="url(#colorElevation)" isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px] border border-slate-700 min-w-[1200px]">
            <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
              <tr>
                <th rowSpan={2} className="border border-slate-700 p-2">檢查站</th>
                <th className="border border-slate-700 p-2 text-left">地名 / 地理特徵</th>
                <th className="border border-slate-700 p-2">網格座標 / 高度</th>
                <th rowSpan={2} className="border border-slate-700 p-2">前視<br/>方位</th>
                <th colSpan={2} className="border border-slate-700 p-2 text-purple-400">距離 (KM)</th>
                <th colSpan={2} className="border border-slate-700 p-2 text-purple-400">上升 (M)</th>
                <th colSpan={2} className="border border-slate-700 p-2 text-purple-400">下降 (M)</th>
                <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400">路段<br/>需時</th>
                <th colSpan={2} className="border border-slate-700 p-2">休息需時 (MIN)</th>
                <th colSpan={2} className="border border-slate-700 p-2">預計時間</th>
                <th rowSpan={2} className="border border-slate-700 p-2">備註/工務</th>
              </tr>
              <tr>
                <th className="border border-slate-700 p-1 font-normal text-slate-500 text-left">(白色填寫)</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">(系統自動)</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">分段</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">累積</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">分段</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">累積</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">分段</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">累積</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">路段</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">檢查站</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">出發</th>
                <th className="border border-slate-700 p-1 font-normal text-slate-500">到達</th>
              </tr>
            </thead>
            <tbody>
              {waypoints.map((wp, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20">
                  <td className="p-2 text-center font-bold text-red-500 bg-red-500/5 border border-slate-700">
                    {i === 0 ? 'SP' : (i === waypoints.length - 1 ? 'EP' : `CP${i}`)}
                  </td>
                  <td className="p-0 border border-slate-700 bg-white/5">
                    <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" placeholder="輸入地理特徵..." />
                  </td>
                  <td className="p-2 border border-slate-700 text-purple-400 font-mono text-[10px] text-center">
                    <div className="opacity-70">{wp.latlng.lat.toFixed(4)}, {wp.latlng.lng.toFixed(4)}</div>
                    <div className="text-purple-300 font-bold">{(wp as any).elevation || 0}m</div>
                  </td>
                  <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center">
                    <input className="w-full bg-transparent p-2 text-center outline-none text-white" placeholder="--" />
                  </td>
                  <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">0.0</td>
                  <td className="p-2 border border-slate-700 text-center text-purple-400 opacity-60">0.0</td>
                  <td className="p-2 border border-slate-700 text-center text-emerald-400">+0</td>
                  <td className="p-2 border border-slate-700 text-center text-emerald-400 opacity-60">+0</td>
                  <td className="p-2 border border-slate-700 text-center text-rose-400">-0</td>
                  <td className="p-2 border border-slate-700 text-center text-rose-400 opacity-60">-0</td>
                  <td className="p-2 border border-slate-700 text-center font-bold text-purple-400">0</td>
                  <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center"><input className="w-full bg-transparent p-2 text-center outline-none" /></td>
                  <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center"><input className="w-full bg-transparent p-2 text-center outline-none" /></td>
                  <td className="p-0 border border-slate-700 bg-white/5 text-center">
                    <input className="w-full bg-transparent p-2 text-center outline-none text-white font-bold" defaultValue={i === 0 ? "08:30" : ""} />
                  </td>
                  <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">--:--</td>
                  <td className="p-0 border border-slate-700 bg-white/5">
                    <input className="w-full bg-transparent p-2 outline-none text-[10px]" placeholder="..." />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-purple-900/30">
            <div className="flex flex-col"><span className="text-red-400 text-[10px] font-bold">太陽 (Sun)</span><span className="text-purple-400 text-sm">🌅 06:14 / 🌇 18:39</span></div>
            <div className="flex flex-col"><span className="text-red-400 text-[10px] font-bold">月亮 (Moon)</span><span className="text-purple-400 text-sm">🌙 20:41 / 🌑 01:31</span></div>
            <div className="flex flex-col"><span className="text-red-400 text-[10px] font-bold">月相 (Phase)</span><span className="text-purple-400 text-sm">🌓 52%</span></div>
            <div className="flex flex-col border-l border-slate-700 pl-4"><span className="text-red-400 text-[10px] font-bold">潮汐 (Tides)</span><span className="text-purple-300 text-[11px]">🌊 10:25 / 16:44</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBadge({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 6, padding: '3px 8px' }}>
      <span style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color, fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{val}</span>
    </div>
  );
}
