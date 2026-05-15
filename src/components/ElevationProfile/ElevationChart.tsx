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
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [hoverX, setHoverX] = useState<number | null>(null);
  const onHoverRef = useRef(onHoverPoint);
  onHoverRef.current = onHoverPoint;

  // 1. 計算標記點位置 (SP / CP / EP)
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

  const elevs = profile.map(p => p.elevation);
  const maxE = Math.max(...elevs);
  const roundedMax = Math.ceil(maxE / 100) * 100;
  const finalMax = (roundedMax - maxE < 30) ? roundedMax + 100 : roundedMax;
  const yDomain: [number, number] = [0, finalMax];

  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('chart')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'chart' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            高度剖面
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            路程計畫表
          </button>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <StatBadge label="總距離" val={`${stats.totalDistance.toFixed(2)} km`} color="#60a5fa" />
          <StatBadge label="總爬升" val={`+${stats.totalAscent.toFixed(0)} m`} color="#34d399" />
          <StatBadge label="總下降" val={`-${stats.totalDescent.toFixed(0)} m`} color="#f87171" />
          <StatBadge label="最高" val={`${stats.maxElevation.toFixed(0)} m`} color="#fbbf24" />
          <StatBadge label="預計時間" val={formatTime(stats.estimatedTime)} color="#a78bfa" />
        </div>
      </div>

      {activeTab === 'chart' ? (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={profile} onMouseMove={onMove} onMouseLeave={onLeave} margin={{ top: 20, right: 16, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
              <XAxis 
                dataKey="distance" type="number" scale="linear" domain={['dataMin', 'dataMax']}
                tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}k`}
                axisLine={false} tickLine={false}
              />
              <YAxis 
                dataKey="elevation" domain={yDomain} width={40}
                ticks={[0, 200, 400, 600, 800, 1000].filter(t => t <= yDomain[1])}
                tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => `${v}m`}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              
              {markers.map((m, i) => (
                <ReferenceLine key={i} x={m.x} stroke={m.color} strokeWidth={1.5} strokeDasharray="3 3"
                  label={{ value: m.label, position: 'top', fill: m.color, fontSize: 10, fontWeight: 'bold', dy: -5 }}
                />
              ))}

              {hoverX !== null && <ReferenceLine x={hoverX} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4 3" />}

              <Area type="monotone" dataKey="elevation" stroke="#60a5fa" strokeWidth={2} fill="url(#elev-grad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
       <div className="overflow-x-auto flex-1">
    <table className="w-full border-collapse text-[11px] border border-slate-700 min-w-[1400px]">
      <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
        <tr>
          <th rowSpan={2} className="border border-slate-700 p-2">檢查站</th>
          <th className="border border-slate-700 p-2 text-left w-40">地名 / 地理特徵</th>
          <th className="border border-slate-700 p-2">網格座標 / 高度</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-center w-12">領航員</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-center w-12">前視<br/>方位</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">距離 (KM)</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">上升 (M)</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">下降 (M)</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-emerald-400 text-center">累積上升<br/>及下降</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">路段<br/>需時</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-center">休息及工需時 (MIN)</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-amber-400 text-center">共需時<br/>(分鐘)</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-center">預計時間</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-slate-500 text-center">實際時間 (手寫)</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-left">備註/工務</th>
        </tr>
        <tr className="text-slate-500">
          <th className="border border-slate-700 p-1 font-normal text-left">(白色填寫)</th>
          <th className="border border-slate-700 p-1 font-normal text-center">(系統自動)</th>
          <th className="border border-slate-700 p-1 font-normal">分段</th><th className="border border-slate-700 p-1 font-normal">累積</th>
          <th className="border border-slate-700 p-1 font-normal">分段</th><th className="border border-slate-700 p-1 font-normal">累積</th>
          <th className="border border-slate-700 p-1 font-normal">分段</th><th className="border border-slate-700 p-1 font-normal">累積</th>
          <th className="border border-slate-700 p-1 font-normal">路段</th><th className="border border-slate-700 p-1 font-normal">檢查點</th>
          <th className="border border-slate-700 p-1 font-normal">出發</th><th className="border border-slate-700 p-1 font-normal">到達</th>
          <th className="border border-slate-700 p-1 font-normal">出發</th><th className="border border-slate-700 p-1 font-normal">到達</th>
        </tr>
      </thead>
      <tbody>
        {waypoints.map((wp, i) => (
          <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20">
            {/* 檢查站 */}
            <td className="p-2 text-center font-bold text-red-500 bg-red-500/5 border border-slate-700">
              {i === 0 ? 'SP' : (i === waypoints.length - 1 ? 'EP' : `CP${i}`)}
            </td>
            {/* 地理特徵 */}
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" placeholder="輸入特徵..." />
            </td>
            {/* 座標高度 */}
            <td className="p-2 border border-slate-700 text-purple-400 font-mono text-[10px] text-center">
              <div className="opacity-70 text-[9px]">{wp.latlng.lat.toFixed(4)}, {wp.latlng.lng.toFixed(4)}</div>
              <div className="text-purple-300 font-bold">{(wp as any).elevation || 0}m</div>
            </td>
            {/* 領航員 */}
            <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center">
              <input className="w-full bg-transparent p-2 text-center outline-none text-white" />
            </td>
            {/* 前視方位 */}
            <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center text-amber-500 font-bold">
              --°
            </td>
            {/* 距離 */}
            <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">0.0</td>
            <td className="p-2 border border-slate-700 text-center text-purple-400 opacity-60">0.0</td>
            {/* 上升 */}
            <td className="p-2 border border-slate-700 text-center text-emerald-400">+0</td>
            <td className="p-2 border border-slate-700 text-center text-emerald-400 opacity-60">+0</td>
            {/* 下降 */}
            <td className="p-2 border border-slate-700 text-center text-rose-400">-0</td>
            <td className="p-2 border border-slate-700 text-center text-rose-400 opacity-60">-0</td>
            {/* 累積上升下降 (Total Gain+Loss) */}
            <td className="p-2 border border-slate-700 text-center text-emerald-500 font-mono">0</td>
            {/* 路段需時 */}
            <td className="p-2 border border-slate-700 text-center font-bold text-purple-400">0</td>
            {/* 休息 */}
            <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center"><input className="w-full bg-transparent p-2 text-center outline-none" placeholder="0" /></td>
            <td className="p-0 border border-slate-700 bg-white/5 w-12 text-center"><input className="w-full bg-transparent p-2 text-center outline-none" placeholder="0" /></td>
            {/* 共需時 */}
            <td className="p-2 border border-slate-700 text-center font-bold text-amber-400">0</td>
            {/* 預計時間 */}
            <td className="p-0 border border-slate-700 bg-white/5 text-center">
              <input className="w-full bg-transparent p-2 text-center outline-none text-white font-bold" defaultValue={i === 0 ? "08:30" : ""} />
            </td>
            <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">--:--</td>
            {/* 實際時間 (空白供手寫) */}
            <td className="p-2 border border-slate-700 text-center text-slate-600">--:--</td>
            <td className="p-2 border border-slate-700 text-center text-slate-600">--:--</td>
            {/* 備註 */}
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 outline-none text-[10px]" placeholder="..." />
            </td>
          </tr>
        ))}
      </tbody>
    </table>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-purple-900/30">
            <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">太陽 (Sun)</span><span className="text-purple-400 text-sm">🌅 06:14 / 🌇 18:39</span></div>
            <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">月亮 (Moon)</span><span className="text-purple-400 text-sm">🌙 20:41 / 🌑 01:31</span></div>
            <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">月相 (Phase)</span><span className="text-purple-400 text-sm">🌓 52%</span></div>
            <div className="flex flex-col border-l border-slate-700 pl-4"><span className="text-red-400 text-[10px] uppercase font-bold">潮汐 (Tides)</span><span className="text-purple-300 text-[11px]">🌊 10:25 (2.1m) | 16:44 (0.7m)</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBadge({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 6, padding: '3px 8px' }}>
      <span style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ color, fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{val}</span>
    </div>
  );
}
