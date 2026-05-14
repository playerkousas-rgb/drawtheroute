import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker } from '../../types'; // 確認 WaypointMarker 已匯入
import { formatTime } from '../../hooks/useTerrainAnalysis';

interface Props {
  profile: ElevationProfilePoint[];
  stats: RouteStats;
  waypoints: WaypointMarker[]; // 1. 新增 waypoints 入口
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
  const onHoverRef = useRef(onHoverPoint);
  onHoverRef.current = onHoverPoint;

  // 2. 計算標記點位置 (SP / CP / EP)
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
        <p className="text-slate-600 text-xs">左側工具列可切換山徑路由 / 直線模式</p>
      </div>
    );
  }

 const elevs = profile.map(p => p.elevation);

  const minE = Math.min(...elevs);

  const maxE = Math.max(...elevs);

  const pad = Math.max(20, (maxE - minE) * 0.12);

  const yDomain: [number, number] = [Math.max(0, minE - pad), maxE + pad];



  return (

    <div className="h-full flex flex-col">

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

          <AreaChart

            data={profile}

            margin={{ top: 20, right: 16, left: 0, bottom: 4 }} // 增加 top 以容納標籤

            onMouseMove={onMove}

            onMouseLeave={onLeave}

          >

            <defs>

              <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">

                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.45} />

                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.03} />

              </linearGradient>

            </defs>



            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />



            <XAxis
  dataKey="distance"
  type="number"
  // 強制 X 軸從 0 開始，到數據最大值結束
  domain={[0, 'dataMax']} 
  // 增加這個：讓數據點不要緊貼邊緣
  padding={{ left: 0, right: 10 }} 
  tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }}
  tickFormatter={v => `${Number(v).toFixed(1)}km`}
  axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
  tickLine={false}
  // 如果數據量大，可以加上這個防止刻度擠在一起
  interval="preserveStartEnd"
/>



            <YAxis

              dataKey="elevation"

              domain={yDomain}

              tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }}

              tickFormatter={v => `${Math.round(v)}m`}

              axisLine={false}

              tickLine={false}

              width={44}

            />



            <Tooltip content={<CustomTooltip />} cursor={false} />



            {/* 3. 渲染 SP / CP / EP 標記線 */}

            {markers.map((m, i) => (

              <ReferenceLine

                key={i}

                x={m.x}

                stroke={m.color}

                strokeWidth={1.5}

                strokeDasharray="3 3"

                label={{

                  value: m.label,

                  position: 'top',

                  fill: m.color,

                  fontSize: 10,

                  fontWeight: 'bold',

                  fontFamily: 'monospace',

                  dy: -5

                }}

              />

            ))}



            {hoverX !== null && (

              <ReferenceLine x={hoverX} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4 3" />

            )}



            <Area

              type="monotone"

              dataKey="elevation"

              stroke="#60a5fa"

              strokeWidth={2}

              fill="url(#elev-grad)"

              dot={false}

              activeDot={{ r: 5, fill: '#60a5fa', stroke: '#fff', strokeWidth: 2 }}

              isAnimationActive={false}

            />

          </AreaChart>

        </ResponsiveContainer>

      </div>

    </div>

  );

}



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
