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

   {activeTab === 'table' && (
        <div className="flex flex-col gap-4 p-4 bg-slate-950 min-h-screen text-slate-200">
          
          {/* 📋 頂部：基礎資料與環境預測 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 左區：手動填寫 (基本資料) */}
            <div className="grid grid-cols-2 gap-2 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
              <div className="flex flex-col gap-1">
                <span className="text-red-400 text-[10px] uppercase font-bold">遠足地區</span>
                <input className="bg-transparent border-b border-slate-700 outline-none text-white text-sm focus:border-blue-500" placeholder="例如：西貢東" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-red-400 text-[10px] uppercase font-bold">預定日期</span>
                <input type="date" className="bg-transparent border-b border-slate-700 outline-none text-white text-sm focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-red-400 text-[10px] uppercase font-bold">組員姓名</span>
                <input className="bg-transparent border-b border-slate-700 outline-none text-white text-sm focus:border-blue-500" placeholder="隊長及成員..." />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-red-400 text-[10px] uppercase font-bold">地圖資訊</span>
                <input className="bg-transparent border-b border-slate-700 outline-none text-white text-sm focus:border-blue-500" placeholder="HM20C / 編號 / 年份" />
              </div>
            </div>

            {/* 右區：紫色自動 (天文與氣象) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-purple-900/10 rounded-lg border border-purple-900/30 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-1 bg-purple-900/40 text-[9px] text-purple-300">SYSTEM AUTO</div>
              <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">🌅 太陽</span><span className="text-purple-400 text-sm font-mono">06:14 / 18:39</span></div>
              <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">🌙 月亮</span><span className="text-purple-400 text-sm font-mono">20:41 / 01:31</span></div>
              <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">🌡️ 氣溫/濕度</span><span className="text-purple-400 text-sm">22°C / 85%</span></div>
              <div className="flex flex-col"><span className="text-red-400 text-[10px] uppercase font-bold">💨 風速風向</span><span className="text-purple-400 text-[11px]">東風 4級 (15km/h)</span></div>
            </div>
          </div>

          {/* 📊 核心：專業路程表格 */}
          <div className="overflow-x-auto rounded-lg border border-slate-700 shadow-2xl">
            <table className="w-full border-collapse text-[11px] min-w-[1300px]">
              <thead className="bg-slate-900 sticky top-0 z-10">
                <tr className="text-red-400">
                  <th rowSpan={2} className="border border-slate-700 p-2 w-12">檢查站</th>
                  <th className="border border-slate-700 p-2 text-left">地名 / 地理特徵</th>
                  <th className="border border-slate-700 p-2 w-32">座標對標 (Grid Ref)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-16 text-purple-400">前視<br/>方位</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400">距離 (KM)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400">上升 (M)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400">下降 (M)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400">路段<br/>需時</th>
                  <th colSpan={2} className="border border-slate-700 p-2">休息需時 (MIN)</th>
                  <th colSpan={2} className="border border-slate-700 p-2">預計時間</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-left">領航備註 / 撤退路線</th>
                </tr>
                <tr className="text-slate-500 font-normal">
                  <th className="border border-slate-700 p-1 text-left">白色填寫 (Name/Feature)</th>
                  <th className="border border-slate-700 p-1 text-center">系統自動 (KK Grid)</th>
                  <th className="border border-slate-700 p-1 text-center">分段</th><th className="border border-slate-700 p-1 text-center">累積</th>
                  <th className="border border-slate-700 p-1 text-center">分段</th><th className="border border-slate-700 p-1 text-center">累積</th>
                  <th className="border border-slate-700 p-1 text-center">分段</th><th className="border border-slate-700 p-1 text-center">累積</th>
                  <th className="border border-slate-700 p-1 text-center">路段</th><th className="border border-slate-700 p-1 text-center">站內</th>
                  <th className="border border-slate-700 p-1 text-center text-red-400">到達 (Arr)</th>
                  <th className="border border-slate-700 p-1 text-center text-blue-400">出發 (Dep)</th>
                </tr>
              </thead>
            <tbody>
  {waypoints.map((_, i) => (
    <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
      {/* 🔴 檢查站編號 (這個可以根據 index 自動產生) */}
      <td className="p-2 text-center font-bold text-red-500 bg-red-500/5 border border-slate-700">
        {i === 0 ? 'SP' : (i === waypoints.length - 1 ? 'EP' : `CP${i}`)}
      </td>

      {/* ⚪ 地名 / 地理特徵：純輸入框，不讀取任何資料 */}
      <td className="p-0 border border-slate-700 bg-white/5">
        <input 
          className="w-full bg-transparent p-2 outline-none text-white focus:bg-blue-500/20" 
          placeholder="點擊輸入地名..." 
        />
      </td>

      {/* 🟣 系統輔助資訊 (這部分如果不需要從變數拿，也可以改成 input) */}
      <td className="p-2 border border-slate-700 text-purple-300 font-mono text-center font-bold text-[12px]">
        KK ---- ----
      </td>

      {/* 方位、距離等欄位全部保持純手動輸入或預設空白 */}
      <td className="p-2 border border-slate-700 text-center text-purple-400 font-mono text-[12px]">---°</td>
      <td className="p-2 border border-slate-700 text-center text-purple-400">0.0</td>
      <td className="p-2 border border-slate-700 text-center text-slate-500">0.0</td>
            </table>
          </div>

          <div className="flex justify-between items-center px-4 py-2 bg-slate-900/30 rounded border border-slate-800 text-[10px]">
            <div className="text-slate-500 italic">* 所有時間均為預計值。數據對標：HK1980 Grid System.</div>
            <div className="text-purple-400 font-mono tracking-widest">TIDE: 10:25 (2.1m) | 16:44 (0.7m)</div>
          </div>
        </div>
      )}
    </div>
  );
}

// 輔助組件定義在主函數外部
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
