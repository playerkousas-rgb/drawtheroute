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

// --- 終極防禦版邏輯：防止除以零導致的黑屏 ---
  
  // 1. 提取海拔數值，使用 Number() 強制轉型並排除所有非有限數字
  const elevs = useMemo(() => 
    profile
      .map(p => Number(p.elevation))
      .filter(e => !isNaN(e) && isFinite(e)),
    [profile]
  );

  // 2. 安全計算範圍：增加「等高檢查」防止除以零
  const { yDomain, safeMin, safeMax } = useMemo(() => {
    let min = elevs.length > 0 ? Math.min(...elevs) : 0;
    let max = elevs.length > 0 ? Math.max(...elevs) : 100;

    // 核心修復：如果最高與最低一樣（或數據不足），強制給予 10m 的高度差
    if (min === max) {
      max = min + 10;
    }

    const range = max - min;
    const pad = Math.max(20, range * 0.15);
    
    return {
      safeMin: min,
      safeMax: max,
      yDomain: [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)] as [number, number]
    };
  }, [elevs]);

  // 3. 安全計算水平高度線
  const horizontalLines = useMemo(() => {
    if (elevs.length === 0) return [];
    const lines = [];
    const step = 100;
    const startH = Math.ceil(yDomain[0] / step) * step;
    
    // 嚴格限制數量，防止異常情況下的死迴圈
    for (let h = startH; h < yDomain[1]; h += step) {
      if (lines.length >= 15) break; 
      lines.push(h);
    }
    return lines;
  }, [yDomain, elevs.length]);

  // 4. 防禦性渲染：如果數據點少於 2 個，或 Y 軸計算異常，直接回傳讀取中
  if (profile.length < 2 || isNaN(yDomain[0])) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-900/20 backdrop-blur-sm">
        <div className="text-4xl opacity-20 animate-pulse">🏔️</div>
        <p className="text-slate-500 text-sm mt-2 font-medium">山徑規劃中...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 數據統計欄位 */}
      <div className="flex items-center gap-1.5 px-4 pt-2 pb-1.5 flex-wrap">
        <StatBadge label="總距離" val={`${stats.totalDistance.toFixed(2)} km`} color="#60a5fa" />
        <StatBadge label="總爬升" val={`+${stats.totalAscent.toFixed(0)} m`} color="#34d399" />
        <StatBadge label="總下降" val={`-${stats.totalDescent.toFixed(0)} m`} color="#f87171" />
        <StatBadge label="最高" val={`${stats.maxElevation.toFixed(0)} m`} color="#fbbf24" />
        <StatBadge label="最低" val={`${stats.minElevation.toFixed(0)} m`} color="#22d3ee" />
        <StatBadge label="預計時間" val={formatTime(stats.estimatedTime)} color="#a78bfa" />
      </div>

      {/* 圖表區域 */}
      <div className="flex-1 min-h-0 px-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={profile}
            margin={{ top: 25, right: 16, left: 0, bottom: 4 }}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          >
            <defs>
              <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.03} />
              </linearGradient>
            </defs>

            {/* 方格紙背景：顯示垂直與水平線 */}
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={true} />

            <XAxis
              dataKey="distance"
              type="number"
              domain={[0, 'dataMax']} 
              tick={{ fill: '#475569', fontSize: 10, fontFamily: 'monospace' }}
              tickFormatter={v => `${Number(v).toFixed(1)}km`}
              axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
              tickLine={false}
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

            {/* 自動生成整百米水平線 */}
            {horizontalLines.map(h => (
              <ReferenceLine 
                key={`h-line-${h}`} 
                y={h} 
                stroke="rgba(148,163,184,0.25)" 
                strokeWidth={1}
                label={{ value: `${h}m`, position: 'insideLeft', fill: '#64748b', fontSize: 9, opacity: 0.8, dy: 10 }}
              />
            ))}

            {/* 標註 SP / CP / EP 垂直線 */}
            {markers.map((m, i) => (
              <ReferenceLine
                key={i}
                x={m.x}
                stroke={m.color}
                strokeWidth={2}
                strokeDasharray="3 3"
                label={{
                  value: m.label,
                  position: 'top',
                  fill: m.color,
                  fontSize: 10,
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  dy: -8
                }}
              />
            ))}

            {/* 滑鼠懸停指示線 */}
            {hoverX !== null && (
              <ReferenceLine x={hoverX} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4 3" />
            )}

            {/* 海拔主要曲線 */}
            <Area
              type="monotone"
              dataKey="elevation"
              stroke="#60a5fa"
              strokeWidth={2}
              fill="url(#elev-grad)"
              dot={false}
              activeDot={{ r: 5, fill: '#60a5fa', stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false} // 關閉動畫，進一步增加穩定性
              connectNulls={true} // 防止數據中間有斷點
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
