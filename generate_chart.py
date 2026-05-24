import re

with open('src/components/ElevationProfile/ElevationChart.tsx', 'r') as f:
    content = f.read()

# We need to completely rewrite ElevationChart.tsx because the changes are too widespread
# (New states, modified handleExportExcel, modified table HTML)

new_content = """import React, { useState, useCallback, useRef, useMemo } from 'react';
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
  
  // Custom Intervals for Chart
  const [xInterval, setXInterval] = useState<string>('');
  const [yInterval, setYInterval] = useState<string>('');

  // Controlled Table Inputs
  const [wpNames, setWpNames] = useState<Record<number, string>>({});
  const [leaders, setLeaders] = useState<Record<number, string>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});

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

  const handleDownloadChartPNG = async () => {
    const chartContainer = document.querySelector('.recharts-wrapper') as HTMLElement;
    if (!chartContainer) return alert('找不到圖表畫面！');
    try {
      const canvas = await html2canvas(chartContainer, { scale: 2, backgroundColor: '#0f172a' });
      const link = document.createElement('a');
      link.download = `橫切面剖面圖-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error(err);
      alert('PNG 下載失敗');
    }
  };

  const handleExportExcel = () => {
    const table = document.querySelector('table');
    if (!table) {
      return alert('請先切換到「路程計畫表」分頁');
    }

    try {
      const wb = XLSX.utils.book_new();

      const infoContainer = document.querySelector('.grid.grid-cols-2.md\\\\:grid-cols-3');
      let mapVal = "";
      let yearVal = "";
      let regionVal = "";
      let leaderVal = "";
      let teamVal = "";

      if (infoContainer) {
        const infoInputs = Array.from(infoContainer.querySelectorAll('input'));
        regionVal = infoInputs[0]?.value || "";
        teamVal   = infoInputs[2]?.value || "";
        mapVal    = infoInputs[3]?.value || ""; 
        yearVal   = infoInputs[4]?.value || ""; 
        leaderVal = infoInputs[5]?.value || "";
      }

      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      const parsedBodyRows: any[][] = [];
      bodyRows.forEach(tr => {
        const rowCells: any[] = [];
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length > 0) {
          tds.forEach((td) => {
            const input = td.querySelector('input');
            if (input) {
              rowCells.push(input.value || ""); 
            } else {
              rowCells.push(td.innerText || td.textContent || ""); 
            }
          });
          parsedBodyRows.push(rowCells);
        }
      });

      const spName = parsedBodyRows.length > 0 ? parsedBodyRows[0][2] : "";
      const epName = parsedBodyRows.length > 0 ? parsedBodyRows[parsedBodyRows.length - 1][5] : "";

      const wsAOA: any[][] = [];

      wsAOA.push(["第二日"]);

      wsAOA.push([
        `地圖組別: ${mapVal}`, "", 
        `編號及年份: ${yearVal}`, "", "",
        `起點: ${spName}`, "", "", "", "", "",
        `終點: ${epName}`, "", "", "", "", "", "", ""
      ]);

      wsAOA.push([
        "路段", "CP", "地理名稱", "出發點\\n(座標 50Q)", "CP", "地理名稱", "到達點\\n(座標 50Q)", 
        "高度(m)", "", "", 
        "前視方向", "距離\\n(km)", "累積距離\\n(km)", "所需時間\\n(min)", "出發\\n時間", "到達\\n時間", "休息時間\\n(min)", "領航員", "備註"
      ]);
      
      wsAOA.push([
        "", "", "", "", "", "", "", 
        "路段起始高度", "上升", "下降", 
        "", "", "", "", "", "", "", "", ""
      ]);

      parsedBodyRows.forEach(row => {
        wsAOA.push([...row]);
      });

      wsAOA.push([]);
      wsAOA.push([]);

      const footerAOA = [
        ["【 📊 行程統計 (Stats) 】", "", "", "", "", "", ""],
        [
          "總距離：", `${stats.totalDistance.toFixed(2)} km`, "",
          "總上升 / 下降：", `+${stats.totalAscent.toFixed(0)} m / -${stats.totalDescent.toFixed(0)} m`, "",
          "最高高度：", `${stats.maxElevation.toFixed(0)} m`
        ],
        [
          "預計總時間：", formatTime ? formatTime(stats.estimatedTime) : `${Math.floor(stats.estimatedTime / 60)}h ${Math.round(stats.estimatedTime % 60)}m`, "",
          "", "", "", ""
        ],
        [],
        ["【 ☀️ 天文數據 (ASTRO) 】", "", "", "【 ⏱️ Naismith 時間算法基準 】", "", "", "【 🌦️ 氣象預測 (Weather Forecast) 】"],
        [
          "🌅 日出 / 日落：", weather ? `${weather.sunrise} / ${weather.sunset}` : "--:-- / --:--", "",
          "基礎時速：", `${naismithSettings?.baseSpeedKmh || "4.0"} km/h`, "",
          "🌡️ 當日最高 / 最低溫：", weather && weather.maxTemp !== undefined && weather.minTemp !== undefined ? `${weather.maxTemp}°C / ${weather.minTemp}°C` : "26°C / 18°C"
        ],
        [
          "🌙 月出 / 月落：", weather ? `${weather.moonrise} / ${weather.moonset}` : "--:-- / --:--", "",
          "每上升 20m 加時：", `+${naismithSettings?.ascentPer20m || "10"} 分`, "",
          "💧 相對濕度：", weather && weather.humidity !== undefined ? `${weather.humidity}%` : "78%"
        ],
        [
          "🌑 月相：", weather ? String(weather.moonPhase).replace(/<\\/?[^>]+(>|$)/g, "") : "--", "",
          "每下降 20m 加時：", `+${naismithSettings?.descentPer20m || "0"} 分`, "",
          "☁️ 雲量 / 降雨：", weather ? `${weather.cloudCover}% / ${weather.precipitation}%` : "40% / 10%"
        ],
        [
          "🌊 潮汐預報：", weather ? weather.tideForecast : "--:-- / --:--", "",
          "", "", "", 
          "🚩 風向風速：", weather ? `${weather.windDirection || "E"} ${weather.windSpeed || "15"} km/h` : "E 15 km/h"
        ],
        [
          "", "", "", 
          "", "", "", 
          "☀️ 紫外線：", weather ? `指數 (${weather.uvIndex})` : "中等 (5)"
        ]
      ];

      footerAOA.forEach(row => wsAOA.push(row));

      const finalWs = XLSX.utils.aoa_to_sheet(wsAOA);

      const merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 18 } }, 
        { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },  
        { s: { r: 1, c: 2 }, e: { r: 1, c: 4 } },  
        { s: { r: 1, c: 5 }, e: { r: 1, c: 10 } }, 
        { s: { r: 1, c: 11 }, e: { r: 1, c: 18 } }, 
        
        { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, 
        { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } }, 
        { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } }, 
        { s: { r: 2, c: 3 }, e: { r: 3, c: 3 } }, 
        { s: { r: 2, c: 4 }, e: { r: 3, c: 4 } }, 
        { s: { r: 2, c: 5 }, e: { r: 3, c: 5 } }, 
        { s: { r: 2, c: 6 }, e: { r: 3, c: 6 } }, 
        { s: { r: 2, c: 7 }, e: { r: 2, c: 9 } }, 
        { s: { r: 2, c: 10 }, e: { r: 3, c: 10 } }, 
        { s: { r: 2, c: 11 }, e: { r: 3, c: 11 } }, 
        { s: { r: 2, c: 12 }, e: { r: 3, c: 12 } }, 
        { s: { r: 2, c: 13 }, e: { r: 3, c: 13 } }, 
        { s: { r: 2, c: 14 }, e: { r: 3, c: 14 } }, 
        { s: { r: 2, c: 15 }, e: { r: 3, c: 15 } }, 
        { s: { r: 2, c: 16 }, e: { r: 3, c: 16 } }, 
        { s: { r: 2, c: 17 }, e: { r: 3, c: 17 } }, 
        { s: { r: 2, c: 18 }, e: { r: 3, c: 18 } }, 
      ];
      finalWs['!merges'] = merges;

      finalWs['!cols'] = [
        { wch: 6 },  { wch: 6 },  { wch: 18 }, { wch: 18 }, { wch: 6 },  { wch: 18 }, { wch: 18 }, 
        { wch: 12 }, { wch: 8 },  { wch: 8 },  { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, 
        { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 20 }
      ];

      XLSX.utils.book_append_sheet(wb, finalWs, "行程表");
      XLSX.writeFile(wb, `行程表_${selectedDate || "未命名"}.xlsx`);
    } catch (err: any) {
      console.error("Excel 匯出失敗:", err);
      alert(`EXCEL 匯出失敗: ${err?.message || err}`);
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

  const customXTicks: number[] = [];
  const xVal = parseFloat(xInterval);
  if (!isNaN(xVal) && xVal > 0) {
    for (let i = 0; i <= stats.totalDistance; i += xVal) customXTicks.push(i);
  }

  const customYTicks: number[] = [];
  const yVal = parseFloat(yInterval);
  if (!isNaN(yVal) && yVal > 0) {
    for (let i = 0; i <= finalMax; i += yVal) customYTicks.push(i);
  }

  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 rounded-lg p-1">
            <button onClick={() => setActiveTab('chart')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'chart' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>高度剖面</button>
            <button onClick={() => setActiveTab('table')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>路程計畫表</button>
          </div>
          {activeTab === 'chart' && (
            <div className="flex gap-4 text-xs ml-2 border-l border-slate-700 pl-4">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">X軸間距 (km):</span>
                <input type="number" step="0.1" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-16 text-white text-center outline-none focus:border-blue-500" value={xInterval} onChange={(e) => setXInterval(e.target.value)} placeholder="自動" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Y軸間距 (m):</span>
                <input type="number" step="10" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-16 text-white text-center outline-none focus:border-blue-500" value={yInterval} onChange={(e) => setYInterval(e.target.value)} placeholder="自動" />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'chart' ? (
            <button onClick={handleDownloadChartPNG} className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-3 py-1.5 rounded text-xs font-medium border border-blue-500/30 transition-colors">下載PNG</button>
          ) : (
            <button onClick={handleExportExcel} className="bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded text-xs font-medium border border-green-500/30 transition-colors flex items-center gap-1">下載 EXCEL</button>
          )}
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
              <XAxis dataKey="distance" type="number" domain={[0, stats.totalDistance]} tickFormatter={(v) => v.toFixed(1)} stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} tickMargin={8} {...(customXTicks.length > 0 ? { ticks: customXTicks } : {})} />
              <YAxis domain={yDomain} stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} tickMargin={8} tickFormatter={(v) => Math.round(v).toString()} {...(customYTicks.length > 0 ? { ticks: customYTicks } : {})} />
              <Tooltip content={<CustomTooltip />} />
              {markers.map((m, i) => (
                <ReferenceLine key={i} x={m.x} stroke={m.color} strokeOpacity={0.5} strokeDasharray="3 3" label={{ position: 'top', value: m.label, fill: m.color, fontSize: 10, fontWeight: 600 }} />
              ))}
              {hoverX !== null && <ReferenceLine x={hoverX} stroke="#fff" strokeOpacity={0.2} />}
              <Area type="monotone" dataKey="elevation" stroke="#60a5fa" strokeWidth={2} fillOpacity={1} fill="url(#elev-grad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">遠足地區：</span>
              <input className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="地區..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">日期：</span>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
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

          <div className="rounded-lg border border-slate-700 overflow-x-auto flex-1 mb-4">
            <table className="w-full border-collapse text-[11px] min-w-[1550px]">
              <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
                <tr>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-10">路段</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-10">CP</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-32 text-left">地理名稱</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-28 cursor-pointer hover:text-red-300 select-none" onClick={() => setCoordMode(coordMode === 'grid' ? 'latlng' : 'grid')}>出發點<br/>(按此切換座標)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-10">CP</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-32 text-left">地理名稱</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-28">到達點<br/>(座標 50Q)</th>
                  <th colSpan={3} className="border border-slate-700 p-2 text-center text-emerald-400">高度(m)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-16">前視<br/>方向</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 w-16">距離<br/>(km)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 w-16">累積距離<br/>(km)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 w-16">所需時間<br/>(min)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-16">出發<br/>時間</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-16">到達<br/>時間</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-amber-400 w-16">休息時間<br/>(min)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-16">領航員</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-left min-w-[100px]">備註</th>
                </tr>
                <tr>
                  <th className="border border-slate-700 p-1 font-normal w-16">路段起始高度</th>
                  <th className="border border-slate-700 p-1 font-normal w-12 text-emerald-400">上升</th>
                  <th className="border border-slate-700 p-1 font-normal w-12 text-rose-400">下降</th>
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

                  if (waypoints.length < 2) return null;

                  return Array.from({ length: waypoints.length - 1 }).map((_, i) => {
                    const wp1 = waypoints[i];
                    const wp2 = waypoints[i + 1];
                    const segment = segments[i];
                    if (!segment) return null;

                    const cumulativeDist = segments.slice(0, i + 1).reduce((sum, s) => sum + s.distance, 0);
                    
                    const currentRouteRest = routeRests[i] || 0;
                    const totalRest = currentRouteRest;

                    const baseTime = (segment.distance / naismithSettings.baseSpeedKmh) * 60;
                    const ascentTime = (segment.ascent / 20) * naismithSettings.ascentPer20m;
                    const descentTime = (segment.descent / 20) * naismithSettings.descentPer20m;
                    const segmentMinutes = Math.round(baseTime + ascentTime + descentTime);

                    const isLastSeg = i === waypoints.length - 2;
                    const getCoords = (wp: WaypointMarker, idx: number) => {
                      if (coordMode === 'grid' && materials && materials[idx]?.grid) {
                        return materials[idx].grid;
                      }
                      return `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;
                    };

                    return (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20 text-center">
                        <td className="p-2 border border-slate-700 text-slate-300 font-bold">{i + 1}</td>
                        <td className="p-2 border border-slate-700 text-red-500 font-bold">{i === 0 ? 'SP' : `CP${i}`}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" value={wpNames[i] || ''} onChange={(e) => setWpNames(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                        <td className="p-2 border border-slate-700 text-purple-400 font-mono text-[10px] whitespace-pre-wrap">{getCoords(wp1, i)}</td>
                        <td className="p-2 border border-slate-700 text-red-500 font-bold">{isLastSeg ? 'EP' : `CP${i + 1}`}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" value={wpNames[i + 1] || ''} onChange={(e) => setWpNames(prev => ({ ...prev, [i + 1]: e.target.value }))} />
                        </td>
                        <td className="p-2 border border-slate-700 text-purple-400 font-mono text-[10px] whitespace-pre-wrap">{getCoords(wp2, i + 1)}</td>
                        <td className="p-2 border border-slate-700 text-purple-300 font-bold">{(wp1 as any).elevation || 0}</td>
                        <td className="p-2 border border-slate-700 text-emerald-400">+{segment.ascent.toFixed(0)}</td>
                        <td className="p-2 border border-slate-700 text-rose-400">-{segment.descent.toFixed(0)}</td>
                        <td className="p-2 border border-slate-700 text-amber-500 font-bold italic">{`${calculateBearing(wp1.latlng.lat, wp1.latlng.lng, wp2.latlng.lat, wp2.latlng.lng)}°`}</td>
                        <td className="p-2 border border-slate-700 text-purple-400 font-bold">{segment.distance.toFixed(2)}</td>
                        <td className="p-2 border border-slate-700 text-purple-400 opacity-80">{cumulativeDist.toFixed(2)}</td>
                        <td className="p-2 border border-slate-700 font-bold text-purple-300 font-mono">{segmentMinutes}</td>
                        <td className="p-2 border border-slate-700 font-bold font-mono">{departureTimes[i]}</td>
                        <td className="p-2 border border-slate-700 font-bold font-mono">{arrivalTimes[i]}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input type="number" className="w-full bg-transparent p-2 text-center outline-none text-white font-mono [appearance:textfield]" value={routeRests[i] || ''} onChange={(e) => { const val = parseInt(e.target.value) || 0; setRouteRests(prev => { const n = [...prev]; n[i] = val; return n; }); }} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 text-center outline-none text-white text-[11px]" value={leaders[i] || ''} onChange={(e) => setLeaders(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 text-left outline-none text-white text-[10px]" value={remarks[i] || ''} onChange={(e) => setRemarks(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          <div className="mt-auto grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
            <div className="space-y-2">
              <span className="text-red-400 text-[10px] uppercase font-bold flex items-center gap-1">☀️ 天文數據 (ASTRO)</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">日出/日落</span><span className="text-purple-400 text-xs">🌅 {weather ? `${weather.sunrise} / ${weather.sunset}` : "--:-- / --:--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月出/月落</span><span className="text-purple-400 text-xs">🌙 {weather ? `${weather.moonrise} / ${weather.moonset}` : "--:-- / --:--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月相</span><span className="text-purple-400 text-xs">{weather ? String(weather.moonPhase).replace(/<\\/?[^>]+(>|$)/g, "") : "--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">潮汐預報</span><span className="text-blue-400 text-[10px]">🌊 {weather ? weather.tideForecast : "--:-- / --:--"}</span></div>
              </div>
            </div>
            <div className="lg:col-span-3 border-l border-slate-800 pl-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <span className="text-emerald-400 text-[10px] uppercase font-bold flex items-center gap-1">⏱️ Naismith 時間算法基準 (唯讀反映)</span>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">基礎時速</span><span className="text-blue-400 text-sm font-bold font-mono">{naismithSettings.baseSpeedKmh} km/h</span></div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">每上升 20m 加時</span><span className="text-emerald-400 text-sm font-bold font-mono">+{naismithSettings.ascentPer20m} 分</span></div>
                  <div className="flex flex-col"><span className="text-slate-500 text-[9px]">每下降 20m 加時</span><span className="text-rose-400 text-sm font-bold font-mono">+{naismithSettings.descentPer20m} 分</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-blue-400 text-[10px] uppercase font-bold flex items-center gap-1">🌦️ 氣象預測 (Weather Forecast)</span>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                 <div className="flex flex-col">
                  <span className="text-slate-500 text-[9px]">當日最高 / 最低溫</span>
                  <span className="text-orange-400 text-xs font-bold">{weather && weather.maxTemp !== undefined && weather.minTemp !== undefined ? `${weather.maxTemp}°C / ${weather.minTemp}°C` : "26°C / 18°C"}</span>
                 </div>
                 <div className="flex flex-col"><span className="text-slate-500 text-[9px]">相對濕度</span><span className="text-blue-300 text-xs font-bold">{weather && weather.humidity !== undefined ? `${weather.humidity}%` : "78%"}</span></div>
                 <div className="flex flex-col"><span className="text-slate-500 text-[9px]">雲量 / 降雨</span><span className="text-slate-300 text-xs font-bold">☁️ {weather ? `${weather.cloudCover}% / ${weather.precipitation}%` : "40% / 10%"}</span></div>
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
"""

with open('src/components/ElevationProfile/ElevationChart.tsx', 'w') as f:
    f.write(new_content)

print("Generated ElevationChart.tsx successfully.")
