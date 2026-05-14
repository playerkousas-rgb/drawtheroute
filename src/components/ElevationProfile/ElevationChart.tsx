import { useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Label
} from 'recharts';
import { ElevationProfilePoint, RouteStats } from '../../types';
import { formatTime } from '../../hooks/useTerrainAnalysis';

// 定義 Waypoint 結構，確保能接收地圖上的 CP 點
interface Waypoint {
  id: string;
  name: string;
  distanceFromStart: number; // 修正：對齊專案資料結構
  elevation?: number;
}

interface Props {
  profile: ElevationProfilePoint[];
  stats: RouteStats;
  waypoints?: Waypoint[]; // 新增：接收來自 useRouteManager 的 CP 點
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
      zIndex: 1000,
    }}>
      <div style={{ color: '#60a5fa' }}>📍 {d.distance.toFixed(3)} km</div>
      <div style={{ color: '#34d399' }}>⛰️ {d.elevation} m</div>
    </div>
  );
};

export default function ElevationChart({ profile, stats, waypoints = [], onHoverPoint }: Props) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const onHoverRef = useRef(onHoverPoint);
  onHoverRef.current = onHoverPoint;

  // 滑鼠移動邏輯
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

  // 設定 Y 軸高度範圍
  const elevs = profile.map(p => p.elevation);
  const minE = Math.min(...elevs);
  const maxE = Math.max(...elevs);
  const pad = Math.max(20, (maxE - minE) * 0.12);
  const yDomain: [number, number] = [Math.max(0, minE - pad), maxE + pad];

  return (
    <div className="h-full flex flex-col">
      {/* 頂部數據面板 */}
      <div className="flex items-center gap-1.5 px-4 pt-2 pb-1.5 flex-wrap">
        <StatBadge label="總距離" val={`${stats.totalDistance.toFixed(2)} km`} color="#60a5fa" />
        <StatBadge label="總爬升" val={`+${stats.totalAscent.toFixed(0)} m`} color="#34d399" />
        <StatBadge label="總下降" val={`-${stats.totalDescent.toFixed(0)} m`} color="#f87171" />
        <StatBadge label="最高" val={`${stats.maxElevation.toFixed(0)} m`} color="#fbbf24" />
        <StatBadge label="最低" val={`${stats.minElevation.toFixed(0)} m`} color="#22d3ee" />
        <StatBadge label="預計時間" val={formatTime(stats.estimatedTime)} color="#a78bfa" />
      </div>

      {/* 圖表本體 */}
      <div className="flex-1 min-h-0 px-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={profile}
            margin={{ top: 25, right: 20, left: 0, bottom: 4 }}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          >
            <defs>
              <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.03} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(148,163,184,0.08)"
              vertical={false}
            />

            <XAxis
              dataKey="distance"
              type="number"
              scale="linear"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }}
              tickFormatter={v => `${Number(v).toFixed(1)}km`}
              axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
              tickLine={false}
              minTickGap={40}
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

            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'rgba(96,165,250,0.4)', strokeWidth: 1.5, strokeDasharray: '4 3' }}
            />

            {/* 核心強化：自動在圖表上標記 CP 點 */}
            {waypoints.map((wp, idx) => (
              <ReferenceLine
                key={wp.id || idx}
                x={wp.distanceFromStart}
                stroke="#fbbf24"
                strokeWidth={2}
                strokeOpacity={0.8}
              >
                <Label
                  value={wp.name || (idx === 0 ? "起點" : idx === waypoints.length - 1 ? "終點" : `CP${idx}`)}
                  position="top"
                  fill="#fbbf24"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="monospace"
                  offset={10}
                />
              </ReferenceLine>
            ))}

            {/* 鼠標懸停線 */}
            {hoverX !== null && (
              <ReferenceLine
                x={hoverX}
                stroke="#60a5fa"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                strokeOpacity={0.8}
              />
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
