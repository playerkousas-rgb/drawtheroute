import React from 'react';
import { WaypointMarker, RouteSegment } from '../../types';
import { useItineraryData } from '../../hooks/useItineraryData';

interface Props {
  waypoints: WaypointMarker[];
  segments: RouteSegment[];
}

export default function DataInspector({ waypoints, segments }: Props) {
  // 呼叫我們剛剛編譯成功的大總管
  const { weather, materials } = useItineraryData(waypoints, segments);

  return (
    <div className="p-3 bg-slate-900/95 text-white rounded-xl border border-emerald-500/30 font-mono text-[10px] backdrop-blur-md shadow-2xl">
      <div className="flex items-center justify-between mb-2 border-b border-emerald-500/20 pb-1">
        <span className="text-emerald-400 font-bold">📡 大總管數據驗收</span>
        <span className="text-[9px] text-slate-500">v1.0.0</span>
      </div>
      
      {/* 天氣數據 */}
      <div className="mb-2 bg-blue-500/10 p-2 rounded border border-blue-500/20">
        <div className="text-blue-400 text-[9px] uppercase tracking-wider mb-1">起點天氣預報</div>
        {weather ? (
          <div className="flex items-center gap-2">
            <img src={weather.icon} alt="icon" className="w-6 h-6" />
            <span className="text-sm font-bold">{weather.temp}°C</span>
            <span className="text-slate-300">{weather.description}</span>
          </div>
        ) : (
          <div className="animate-pulse text-slate-500">正在獲取 OpenWeather 數據...</div>
        )}
      </div>

      {/* 點位加工數據 */}
      <div className="space-y-1">
       <div className="grid grid-cols-6 text-slate-500 border-b border-slate-800 pb-1 px-1">
  <span>站點</span>
  <span>KK Grid</span>
  <span>方位</span>
  <span>里程</span>
  <span>ETA</span>
  <span>高度</span>
</div>
{materials.map((m, i) => (
  <div key={m.id} className="grid grid-cols-6 px-1 py-0.5 hover:bg-emerald-500/5">
    <span className="text-slate-400">#{i}</span>
    <span className="text-emerald-300">{m.grid}</span>
    <span className="text-amber-300">{m.bearing}°</span>
    <span className="text-blue-300">{m.cumDist}k</span>
    <span className="text-violet-300">{m.eta}</span>
    <span className="text-slate-300">{m.elevation.toFixed(0)}m</span>
  </div>
))}
      </div>
    </div>
  );
}
