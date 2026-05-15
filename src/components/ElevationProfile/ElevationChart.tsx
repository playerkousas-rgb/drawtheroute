import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker } from '../../types';
import { formatTime } from '../../hooks/useTerrainAnalysis';
import { useItineraryData } from '../../hooks/useItineraryData';
import { WaypointMarker, RouteSegment } from '../../types';

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

export default function ElevationChart({ waypoints, segments }: { waypoints: WaypointMarker[], segments: RouteSegment[] }) {
  const { weather, materials } = useItineraryData(waypoints, segments);
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
      <div className="overflow-x-auto flex-1 flex flex-col gap-4">
  {/* 1. 行程基本資訊 (Excel 頂部欄位) */}
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 p-3 bg-slate-900/80 rounded-lg border border-slate-700 text-[11px]">
    <div className="flex items-center gap-2">
      <span className="text-red-400 whitespace-nowrap">遠足地區：</span>
      <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="請輸入..." />
    </div>
    <div className="flex items-center gap-2">
      <span className="text-red-400 whitespace-nowrap">日期：</span>
      <input type="date" className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
    </div>
    <div className="flex items-center gap-2">
      <span className="text-red-400 whitespace-nowrap">組員姓名：</span>
      <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="姓名..." />
    </div>
    <div className="flex items-center gap-2">
      <span className="text-red-400 whitespace-nowrap">地圖組別：</span>
      <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="HM20C..." />
    </div>
    <div className="flex items-center gap-2">
      <span className="text-red-400 whitespace-nowrap">編號及年份：</span>
      <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="2024..." />
    </div>
    <div className="flex items-center gap-2">
      <span className="text-red-400 whitespace-nowrap">領隊：</span>
      <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
    </div>
  </div>

  {/* 2. 主表格 */}
  <div className="rounded-lg border border-slate-700 overflow-hidden">
    <table className="w-full border-collapse text-[11px] min-w-[1550px]">
      <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
        <tr>
          <th rowSpan={2} className="border border-slate-700 p-2 w-16">檢查站</th>
          <th className="border border-slate-700 p-2 text-left w-64">地名 / 地理特徵</th>
          <th className="border border-slate-700 p-2 w-40">網格座標 / 高度</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-center w-16">領航員</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-center w-16">前視<br/>方位</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">距離 (KM)</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">上升 (M)</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">下降 (M)</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-emerald-400 text-center w-20">累積上升<br/>及下降</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center w-20">路段<br/>需時</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-center">休息及工需時 (MIN)</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-amber-400 text-center w-20">共需時</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-center">預計時間</th>
          <th colSpan={2} className="border border-slate-700 p-2 text-slate-500 text-center">實際時間 (手寫)</th>
          <th rowSpan={2} className="border border-slate-700 p-2 text-left min-w-[100px]">備註/工務</th>
        </tr>
        <tr className="text-slate-500">
          <th className="border border-slate-700 p-1 font-normal text-left">(白色填寫)</th>
          <th className="border border-slate-700 p-1 font-normal text-center">(系統自動)</th>
          <th className="border border-slate-700 p-1 font-normal w-14">分段</th><th className="border border-slate-700 p-1 font-normal w-14">累積</th>
          <th className="border border-slate-700 p-1 font-normal w-14">分段</th><th className="border border-slate-700 p-1 font-normal w-14">累積</th>
          <th className="border border-slate-700 p-1 font-normal w-14">分段</th><th className="border border-slate-700 p-1 font-normal w-14">累積</th>
          <th className="border border-slate-700 p-1 font-normal w-16">路段</th><th className="border border-slate-700 p-1 font-normal w-16">檢查點</th>
          <th className="border border-slate-700 p-1 font-normal w-18">出發</th><th className="border border-slate-700 p-1 font-normal w-18">到達</th>
          <th className="border border-slate-700 p-1 font-normal w-18">出發</th><th className="border border-slate-700 p-1 font-normal w-18">到達</th>
        </tr>
      </thead>
      <tbody>
        {materials.map((m, i) => (
          <tr key={m.id} className="border-b border-slate-800 hover:bg-slate-800/20">
            <td className="p-2 text-center font-bold text-red-500 bg-red-500/5 border border-slate-700">
              {m.name}
            </td>
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" placeholder="..." />
            </td>
            <td className="p-2 border border-slate-700 text-emerald-400 font-mono text-center">
              <div className="font-bold leading-tight mb-1 whitespace-pre-line">{m.grid}</div>
              <div className="text-purple-300 font-bold bg-purple-900/20 rounded py-0.5">{m.elevation.toFixed(0)} m</div>
            </td>
            <td className="p-0 border border-slate-700 bg-white/5 text-center"><input className="w-full bg-transparent p-2 text-center outline-none text-white" /></td>
            <td className="p-2 border border-slate-700 text-center text-amber-500 font-bold italic">{m.bearing}°</td>
            <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">
              {i === 0 ? '0.00' : segments[i-1]?.distance.toFixed(2)}
            </td>
            <td className="p-2 border border-slate-700 text-center text-purple-400 opacity-60">{m.cumDist}</td>
            <td className="p-2 border border-slate-700 text-center text-emerald-400">
              {i === 0 ? '+0' : `+${segments[i-1]?.ascent.toFixed(0)}`}
            </td>
            <td className="p-2 border border-slate-700 text-center text-emerald-400 opacity-60">--</td>
            <td className="p-2 border border-slate-700 text-center text-rose-400">
              {i === 0 ? '-0' : `-${segments[i-1]?.descent.toFixed(0)}`}
            </td>
            <td className="p-2 border border-slate-700 text-center text-rose-400 opacity-60">--</td>
            <td className="p-2 border border-slate-700 text-center text-emerald-500 font-mono font-bold">
              {i === 0 ? '0' : (segments[i-1]?.ascent + segments[i-1]?.descent).toFixed(0)}
            </td>
            <td className="p-2 border border-slate-700 text-center font-bold text-purple-400">
              {i === 0 ? '--' : Math.round((segments[i-1]?.distance / 4) * 60)}
            </td>
            <td className="p-0 border border-slate-700 bg-white/5 text-center"><input className="w-full bg-transparent p-2 text-center outline-none" placeholder="0" /></td>
            <td className="p-0 border border-slate-700 bg-white/5 text-center"><input className="w-full bg-transparent p-2 text-center outline-none" placeholder="0" /></td>
            <td className="p-2 border border-slate-700 text-center font-bold text-amber-400">--</td>
            <td className="p-2 border border-slate-700 text-center text-white font-bold bg-white/5">
              {i === 0 ? m.eta : materials[i-1].eta}
            </td>
            <td className="p-2 border border-slate-700 text-center text-violet-400 font-bold bg-violet-400/5">
              {m.eta}
            </td>
            <td className="p-2 border border-slate-700 text-center text-slate-600 font-mono">--:--</td>
            <td className="p-2 border border-slate-700 text-center text-slate-600 font-mono">--:--</td>
            <td className="p-0 border border-slate-700 bg-white/5">
              <input className="w-full bg-transparent p-2 outline-none text-[10px]" placeholder="..." />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  {/* 3. 底部數據面板 (天文 + 氣象預期) */}
  <div className="mt-auto grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
    <div className="space-y-2">
      <span className="text-red-400 text-[10px] uppercase font-bold flex items-center gap-1">☀️ 天文數據 (Astro)</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">日出/日落</span><span className="text-purple-400 text-xs">🌅 {weather?.sunrise || '06:14'} / {weather?.sunset || '18:39'}</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月出/日落</span><span className="text-purple-400 text-xs">🌙 20:41 / 01:31</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月相</span><span className="text-purple-400 text-xs">🌓 52%</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">潮汐預報</span><span className="text-blue-400 text-[10px]">🌊 10:25 / 16:44</span></div>
      </div>
    </div>

    <div className="lg:col-span-3 border-l border-slate-800 pl-4 space-y-2">
      <span className="text-blue-400 text-[10px] uppercase font-bold flex items-center gap-1">🌦️ 氣象預測 ({weather?.location || 'Weather Forecast'})</span>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">溫度 / 描述</span><span className="text-orange-400 text-sm font-bold">{weather ? `${weather.temp}°C / ${weather.description}` : '--°C'}</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">相對濕度</span><span className="text-blue-300 text-sm font-bold">{weather?.humidity || '--'}%</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">雲量 / 降雨</span><span className="text-slate-300 text-sm font-bold">☁️ {weather?.clouds || '--'}%</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">氣壓</span><span className="text-emerald-400 text-sm font-bold">{weather?.pressure || '--'} hPa</span></div>
        <div className="flex flex-col"><span className="text-slate-500 text-[9px]">紫外線</span><span className="text-yellow-500 text-sm font-bold">中等 (5)</span></div>
      </div>
    </div>
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
