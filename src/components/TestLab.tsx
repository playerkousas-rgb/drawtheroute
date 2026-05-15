import React from 'react';
import { useItineraryData } from '../hooks/useItineraryData';

// 假設這是在地圖組件中傳入的測試數據
export function TestLab({ waypoints }: { waypoints: any[] }) {
  const { materials, weather, isReady } = useItineraryData(waypoints);

  if (!isReady) return <div>⏳ 正在準備材料...</div>;

  return (
    <div className="p-8 bg-slate-900 text-white font-mono">
      <h1 className="text-2xl mb-4 text-emerald-400">🧪 材料完備性測試儀</h1>
      
      <section className="mb-8 p-4 border border-blue-500 rounded">
        <h2 className="text-blue-400">🌦️ 天氣材料狀態：</h2>
        <pre>{JSON.stringify(weather, null, 2)}</pre>
      </section>

      <section className="p-4 border border-purple-500 rounded">
        <h2 className="text-purple-400">📍 行程點材料清單：</h2>
        <div className="space-y-4">
          {materials.map((m, idx) => (
            <div key={idx} className="bg-slate-800 p-2 rounded">
              <div>點位：{m.id}</div>
              <div>網格：{m.grid}</div>
              <div>高度：{m.alt} m</div>
              <div>方位角：{m.bearing ? `${m.bearing}°` : "終點無方位"}</div>
              <div className="text-slate-500 text-xs">原始座標：{m.latlngStr}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
