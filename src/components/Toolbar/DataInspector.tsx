import React from 'react';
import { WaypointMarker, RouteSegment } from '../../types';
import { useItineraryData } from '../../hooks/useItineraryData';

interface Props {
  waypoints: WaypointMarker[];
  segments: RouteSegment[];
}

export default function DataInspector({ waypoints, segments }: Props) {
  // 只傳兩個參數，解決 TS2554 報錯
  const { weather, materials } = useItineraryData(waypoints, segments);

  return (
    <div className="p-3 bg-slate-900/95 text-white rounded-xl border border-emerald-500/30 font-mono text-[10px] backdrop-blur-md shadow-2xl w-[320px]">
      <div className="flex items-center justify-between mb-2 border-b border-emerald-500/30 pb-1">
        <span className="text-emerald-400 font-bold">🛰️ 大總管全數據驗收 (BETA)</span>
      </div>
      
      {weather && (
        <div className="mb-2 bg-blue-500/10 p-2 rounded border border-blue-500/20 flex items-center justify-between">
          <span className="text-blue-300 font-bold">{weather.temp}°C {weather.description}</span>
          <span className="text-slate-400">☀️ 日出: {weather.sunrise}</span>
        </div>
      )}

      <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800 text-[8px]">
              <th className="py-1">站點</th>
              <th>KK GRID</th>
              <th>方位</th>
              <th>里程</th>
              <th>ETA</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id} className="border-b border-slate-800/30 hover:bg-white/5">
                <td className="py-2 text-slate-400">{m.name}</td>
                <td className="text-emerald-400 font-bold leading-tight">{m.grid}</td>
                <td className="text-amber-400">{m.bearing}°</td>
                <td className="text-blue-400">{m.cumDist}k</td>
                <td className="text-violet-400 font-bold">{m.eta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
