import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker, RouteSegment, NaismithSettings } from '../../types';
import { formatTime } from '../../hooks/useTerrainAnalysis';
import { calculateBearing } from '../../utils/coordUtils';
import { useItineraryData } from '../../hooks/useItineraryData';

import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface Props {
  profile: ElevationProfilePoint[];
  stats: RouteStats;
  waypoints: WaypointMarker[];
  segments: RouteSegment[];
  naismithSettings: NaismithSettings;
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

// 貼心時間格式化工具：將純分鐘數轉為 Xh Ym
const formatMinutes = (minutes: number): string => {
  if (!minutes || minutes === 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

// 🟢 專注計算單一路段 Naismith 純步行時間（單位：分鐘）
const calculateSegmentNaismithMinutes = (
  seg: RouteSegment | null, 
  settings: NaismithSettings
): number => {
  if (!seg) return 0;
  const baseTime = (seg.distance / settings.baseSpeedKmh) * 60;
  const ascentTime = (seg.ascent / 20) * settings.ascentPer20m;
  const descentTime = (seg.descent / 20) * settings.descentPer20m;
  return baseTime + ascentTime + descentTime;
};

export default function ElevationChart({
  profile,
  stats,
  waypoints,
  segments,
  naismithSettings,
  onHoverPoint
}: Props) {
  const [coordMode, setCoordMode] = useState<'grid' | 'latlng'>('grid');
  const [routeRests, setRouteRests] = useState<number[]>([]);
  const [cpRests, setCpRests] = useState<number[]>([]);
  
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const { materials, weather } = useItineraryData(waypoints, segments, selectedDate);

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

// ==================== 下載功能 ====================
  const exportContainerRef = useRef<HTMLDivElement>(null);

  // 高度剖面 → 下載 PNG
  const handleDownloadChartPNG = async () => {
    const chartContainer = document.querySelector('.recharts-wrapper') as HTMLElement;
    if (!chartContainer) return alert('找不到圖表畫面！');

    const canvas = await html2canvas(chartContainer, { 
      scale: 2, 
      backgroundColor: '#0f172a' 
    });
    
    const link = document.createElement('a');
    link.download = `橫切面剖面圖-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

 // 路程計畫表 → PDF 下載（針對短表格優化）
  const handleExportTablePDF = async () => {
    if (!exportContainerRef.current) {
      return alert('請先切換到「路程計畫表」分頁');
    }

    try {
      // 給 React 一點時間渲染完成
      await new Promise(resolve => setTimeout(resolve, 500));

      const container = exportContainerRef.current;

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#0f172a',
        logging: false,
        allowTaint: true,
        width: container.offsetWidth,
        height: container.offsetHeight + 50,   // 多留一點空間
      });

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: [canvas.width * 0.72, canvas.height * 0.72]
      });

      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 15, 15, pdf.internal.pageSize.getWidth() - 30, 0);
      
      pdf.save(`行程表-${selectedDate || Date.now()}.pdf`);
      
    } catch (error) {
      console.error(error);
      alert('PDF 產生失敗，請重新整理頁面後再試一次');
    }
  };
 // EXCEL 下載（包含上方資訊 + 表格 + 下方數據）
  const handleExportExcel = () => {
    const table = document.querySelector('table');
    if (!table) return alert('請先切換到「路程計畫表」');

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([]);

    let row = 0;

    // ==================== 1. 上方標題與基本資訊 ====================
    XLSX.utils.sheet_add_aoa(ws, [["山徑路程計畫表"]], { origin: `A${++row}` });
    row += 2;

    const basicInfo = [
      ["遠足地區", document.querySelector('input[placeholder="請輸入..."]')?.value || ""],
      ["日期", selectedDate],
      ["組員姓名", ""],
      ["地圖組別", ""],
      ["編號及年份", ""],
      ["領隊", ""]
    ];

    XLSX.utils.sheet_add_aoa(ws, basicInfo, { origin: `A${row}` });
    row += basicInfo.length + 2;

    // ==================== 2. 主表格 ====================
    const tableSheet = XLSX.utils.table_to_sheet(table);
    XLSX.utils.sheet_add_aoa(ws, [[" "]], { origin: `A${row}` }); // 分隔行
    XLSX.utils.sheet_add_sheet(ws, tableSheet, `A${row + 2}`);

    // 調整主表格欄寬
    ws['!cols'] = [
      { wch: 8 }, { wch: 35 }, { wch: 22 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 22 }
    ];

    row += 30; // 預留空間給表格

    // ==================== 3. 下方數據面板 ====================
    XLSX.utils.sheet_add_aoa(ws, [["天文數據 (ASTRO)"]], { origin: `A${row}` });
    row++;

    const astroData = [
      ["日出 / 日落", weather?.sunrise || "--", weather?.sunset || "--"],
      ["月出 / 月落", weather?.moonrise || "--", weather?.moonset || "--"],
      ["月相", weather?.moonPhase || "--"]
    ];
    XLSX.utils.sheet_add_aoa(ws, astroData, { origin: `A${row}` });
    row += astroData.length + 1;

    XLSX.utils.sheet_add_aoa(ws, [["Naismith 時間算法"]], { origin: `A${row}` });
    row++;
    const naismithData = [
      ["基礎時速", `${naismithSettings.baseSpeedKmh} km/h`],
      ["每上升 20m 加時", `+${naismithSettings.ascentPer20m} 分`],
      ["每下降 20m 加時", `+${naismithSettings.descentPer20m} 分`]
    ];
    XLSX.utils.sheet_add_aoa(ws, naismithData, { origin: `A${row}` });

    // ==================== 儲存 ====================
    XLSX.writeFile(wb, `行程表_${selectedDate || Date.now()}.xlsx`);
  };
      // alert('✅ EXCEL 已成功下載！');
    } catch (err) {
      alert('EXCEL 匯出失敗，請稍後再試');
    }
  };
  
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

        {/* 下載按鈕區域 */}
      <div className="flex items-center gap-3">
          {activeTab === 'chart' ? (
            <>
              <button
                onClick={handleDownloadChartPNG}
                className="px-4 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-medium flex items-center gap-2"
              >
                📸 下載 PNG
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleExportExcel}
                className="px-4 py-2 rounded-lg border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 font-medium flex items-center gap-2"
              >
                📊 匯出 EXCEL
              </button>
              <button
                onClick={handleExportTablePDF}
                className="px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium flex items-center gap-2"
              >
                📄 下載 PDF 報告
              </button>
            </>
          )}
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
       <div ref={exportContainerRef} className="overflow-x-auto flex-1 flex flex-col gap-6">
          {/* 1. 行程基本資訊 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 p-3 bg-slate-900/80 rounded-lg border border-slate-700 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">遠足地區：</span>
              <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="請輸入..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">日期：</span>
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" 
              />
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
                  <th className="border border-slate-700 p-2 w-40">網格座標(經緯) / 高度</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-center w-16">領航員</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-center w-16">前視<br/>方位</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">距離 (KM)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">上升 (M)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">下降 (M)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-emerald-400 text-center w-20">累積上升<br/>及下降(M)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center w-20">路段需時</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-center">休息及事工需時 (分鐘)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-amber-400 text-center w-20">共需時</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-center">預計時間</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-slate-500 text-center">實際時間 (手寫)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-left min-w-[100px]">備註/事工</th>
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
  {(() => {
    const timeToMinutes = (tStr: string): number => {
      const parts = tStr.split(":");
      if (parts.length !== 2) return 8 * 60 + 30;
      return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
    };

    const minutesToTime = (mins: number): string => {
      const h = Math.floor((mins % 1440) / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    // ─── 💡 貼心時間格式化工具：將純分鐘數轉為 Xh Ym ───
    const formatMinutes = (minutes: number): string => {
      if (!minutes || minutes === 0) return '0m';
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      
      if (hours === 0) return `${mins}m`;
      if (mins === 0) return `${hours}h`;
      return `${hours}h ${mins}m`;
    };

    const departureTimes: string[] = Array(waypoints.length).fill("--:--");
    const arrivalTimes: string[] = Array(waypoints.length).fill("--:--");
    
    departureTimes[0] = "08:30";

    for (let idx = 0; idx < waypoints.length; idx++) {
      const seg = segments[idx];
      if (seg) {
        const baseTime = (seg.distance / naismithSettings.baseSpeedKmh) * 60;
        const ascentTime = (seg.ascent / 20) * naismithSettings.ascentPer20m;
        const descentTime = (seg.descent / 20) * naismithSettings.descentPer20m;
        const segMinutes = Math.round(baseTime + ascentTime + descentTime);
        
        const routeRest = routeRests[idx] || 0;
        const arrivalMins = timeToMinutes(departureTimes[idx]) + segMinutes + routeRest;
        arrivalTimes[idx] = minutesToTime(arrivalMins);
        
        if (idx + 1 < waypoints.length) {
          const currentCpRest = cpRests[idx] || 0;
          departureTimes[idx + 1] = minutesToTime(arrivalMins + currentCpRest);
        }
      }
    }

    return waypoints.map((wp, i) => {
      const segment = i < segments.length ? segments[i] : null;
      const cumulativeDist = segments.slice(0, i + 1).reduce((sum, s) => sum + s.distance, 0);
      const cumulativeAscent = segments.slice(0, i + 1).reduce((sum, s) => sum + s.ascent, 0);
      const cumulativeDescent = segments.slice(0, i + 1).reduce((sum, s) => sum + s.descent, 0);
      const currentSegmentVertMovement = segment ? (segment.ascent + segment.descent) : 0;
      const baseTime = segment ? (segment.distance / naismithSettings.baseSpeedKmh) * 60 : 0;
      const ascentTime = segment ? (segment.ascent / 20) * naismithSettings.ascentPer20m : 0;
      const descentTime = segment ? (segment.descent / 20) * naismithSettings.descentPer20m : 0;
      const segmentMinutes = Math.round(baseTime + ascentTime + descentTime);
      const currentRouteRest = routeRests[i] || 0;
      const currentCpRest = cpRests[i] || 0;
      const totalMinutes = segmentMinutes + currentRouteRest + currentCpRest;
      const isLastRow = i === waypoints.length - 1;

      return (
        <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20">
          <td className="p-2 text-center font-bold text-red-500 bg-red-500/5 border border-slate-700">
            {i === 0 ? 'SP' : (isLastRow ? 'EP' : `CP${i}`)}
          </td>
          
          <td className="p-0 border border-slate-700 bg-white/5">
            <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" placeholder="..." />
          </td>
          
          <td className="p-2 border border-slate-700 text-purple-400 font-mono text-center">
            <div onClick={() => setCoordMode(coordMode === 'grid' ? 'latlng' : 'grid')}
              className="text-purple-400 font-bold text-[11px] mb-1 cursor-pointer hover:text-purple-300 select-none">
              {coordMode === 'grid' 
                ? (materials && materials[i]?.grid ? materials[i].grid : `🌐 ${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`)
                : `🌐 ${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`
              }
            </div>
            <div className="text-purple-300 font-bold bg-purple-900/20 rounded py-0.5">
              {(wp as any).elevation || 0} m
            </div>
          </td>
          
          <td className="p-0 border border-slate-700 bg-white/5 text-center">
            <input className="w-full bg-transparent p-2 text-center outline-none text-white" />
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-amber-500 font-bold italic">
            {segment && waypoints[i + 1] ? (
              `${calculateBearing(
                wp.latlng.lat, wp.latlng.lng,
                waypoints[i + 1].latlng.lat, waypoints[i + 1].latlng.lng
              )}°`
            ) : "--°"}
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold">
            {!isLastRow && segment ? segment.distance.toFixed(2) : "0.00"}
          </td>
          <td className="p-2 border border-slate-700 text-center text-purple-400 opacity-60">
            {!isLastRow && segment ? cumulativeDist.toFixed(2) : "0.00"}
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-emerald-400">
            {!isLastRow && segment ? `+${segment.ascent.toFixed(0)}` : "+0"}
          </td>
          <td className="p-2 border border-slate-700 text-center text-emerald-400 opacity-60">
            {!isLastRow && segment ? `+${cumulativeAscent.toFixed(0)}` : "+0"}
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-rose-400">
            {!isLastRow && segment ? `-${segment.descent.toFixed(0)}` : "-0"}
          </td>
          <td className="p-2 border border-slate-700 text-center text-rose-400 opacity-60">
            {!isLastRow && segment ? `-${cumulativeDescent.toFixed(0)}` : "-0"}
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-emerald-500 font-mono font-bold">
            {!isLastRow && segment ? currentSegmentVertMovement.toFixed(0) : "0"}
          </td>
          
          {/* 🛠️ 優化後的路段需時：加入 formatMinutes */}
          <td className="p-2 border border-slate-700 text-center font-bold text-purple-300 font-mono text-[12px]">
            {!isLastRow ? formatMinutes(segmentMinutes) : "0m"}
          </td>
          
          <td className="p-0 border border-slate-700 bg-white/5 text-center">
            <input 
              type="number"
              className="w-full bg-transparent p-2 text-center outline-none text-white font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
              placeholder="0"
              value={currentRouteRest || ''}
              disabled={isLastRow}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                const next = [...routeRests];
                next[i] = val;
                setRouteRests(next);
              }}
            />
          </td>
          
          <td className="p-0 border border-slate-700 bg-white/5 text-center">
            <input 
              type="number"
              className="w-full bg-transparent p-2 text-center outline-none text-white font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
              placeholder="0"
              value={currentCpRest || ''}
              disabled={isLastRow}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                const next = [...cpRests];
                next[i] = val;
                setCpRests(next);
              }}
            />
          </td>
          
          {/* 🛠️ 優化後的共需時：加入 formatMinutes */}
          <td className="p-2 border border-slate-700 text-center font-bold text-amber-400 font-mono text-[12px]">
            {isLastRow ? "0m" : formatMinutes(totalMinutes)}
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-white font-bold font-mono">
            {departureTimes[i]}
          </td>
          <td className="p-2 border border-slate-700 text-center text-purple-400 font-bold font-mono">
            {isLastRow ? arrivalTimes[i - 1] || "--:--" : arrivalTimes[i]}
          </td>
          
          <td className="p-2 border border-slate-700 text-center text-slate-600 font-mono">--:--</td>
          <td className="p-2 border border-slate-700 text-center text-slate-600 font-mono">--:--</td>
          
          <td className="p-0 border border-slate-700 bg-white/5">
            <input className="w-full bg-transparent p-2 outline-none text-[10px]" placeholder="..." />
          </td>
        </tr>
      );
    });
  })()}
</tbody>
            </table>
          </div>

          {/* 3. 底部數據面板 */}
          <div className="mt-auto grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
            <div className="space-y-2">
              <span className="text-red-400 text-[10px] uppercase font-bold flex items-center gap-1">☀️ 天文數據 (ASTRO)</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <span className="text-slate-500 text-[9px]">日出/日落</span>
                  <span className="text-purple-400 text-xs">
                    🌅 {weather ? `${weather.sunrise} / ${weather.sunset}` : "--:-- / --:--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-slate-500 text-[9px]">月出/月落</span>
                  <span className="text-purple-400 text-xs">
                    🌙 {weather ? `${weather.moonrise} / ${weather.moonset}` : "--:-- / --:--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-slate-500 text-[9px]">月相</span>
                  <span className="text-purple-400 text-xs">
                    {weather ? String(weather.moonPhase).replace(/<\/?[^>]+(>|$)/g, "") : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-slate-500 text-[9px]">潮汐預報</span>
                  <span className="text-blue-400 text-[10px]">
                    🌊 {weather ? weather.tideForecast : "--:-- / --:--"}
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 border-l border-slate-800 pl-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <span className="text-emerald-400 text-[10px] uppercase font-bold flex items-center gap-1">⏱️ Naismith 時間算法基準 (唯讀反映)</span>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col">
                    <span className="text-slate-500 text-[9px]">基礎時速</span>
                    <span className="text-blue-400 text-sm font-bold font-mono">{naismithSettings.baseSpeedKmh} km/h</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-slate-500 text-[9px]">每上升 20m 加時</span>
                    <span className="text-emerald-400 text-sm font-bold font-mono">+{naismithSettings.ascentPer20m} 分</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-slate-500 text-[9px]">每下降 20m 加時</span>
                    <span className="text-rose-400 text-sm font-bold font-mono">+{naismithSettings.descentPer20m} 分</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-blue-400 text-[10px] uppercase font-bold flex items-center gap-1">🌦️ 氣象預測 (Weather Forecast)</span>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">溫度 / 體感</span><span className="text-orange-400 text-xs font-bold">{weather ? `${weather.temp}°C / ${weather.feelsLike}°C` : "24°C / 26°C"}</span></div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">相對濕度</span><span className="text-blue-300 text-xs font-bold">{weather && weather.humidity !== undefined ? `${weather.humidity}%` : "78%"}</span></div>
                  <div className="flex flex-col">
                    <span className="text-slate-500 text-[9px]">雲量 / 降雨</span>
                    <span className="text-slate-300 text-xs font-bold">
                      ☁️ {weather ? `${weather.cloudCover}% / ${weather.precipitation}%` : "40% / 10%"}
                    </span>
                  </div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">風向風速</span><span className="text-emerald-400 text-xs font-bold">🚩 {weather ? `${weather.windDirection} ${weather.windSpeed} km/h` : "E 15 km/h"}</span></div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">紫外線</span><span className="text-yellow-500 text-xs font-bold">{weather ? `指數 (${weather.uvIndex})` : "中等 (5)"}</span></div>
                </div>
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
