import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker, RouteSegment, NaismithSettings } from '../../types';
import { hoverSync } from '../../utils/hoverSync';
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
  onPointClick: (p: ElevationProfilePoint) => void;
  externalDistance?: number;
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

const timeToMinutes = (tStr: string) => {
  if (!tStr) return 0;
  const parts = tStr.split(":");
  if (parts.length !== 2) return 8 * 60 + 30; // default 08:30 if weird format
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
};

const minutesToTime = (mins: number) => {
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const formatMinutes = (minutes: number): string => {
  if (!minutes || minutes === 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

function StatBadge({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 6, padding: '3px 8px' }}>
      <span style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ color, fontSize: 12, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{val}</span>
    </div>
  );
}

export default function ElevationChart({
  profile,
  stats,
  waypoints,
  segments,
  naismithSettings,
  onPointClick,
  externalDistance,
  onHoverPoint
}: Props) {
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [hoverX, setHoverX] = useState<number | null>(null);

  const [coordMode, setCoordMode] = useState<'grid' | 'latlng'>('grid');
  
  // Custom Intervals for Chart
  const [xInterval, setXInterval] = useState<string>('');
  const [yInterval, setYInterval] = useState<string>('');

  // Header form states
  const [headerInfo, setHeaderInfo] = useState({
    region: '', team: '', mapGroup: '', year: '', leader: ''
  });
  
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const { materials, weather } = useItineraryData(waypoints, segments, selectedDate);

  // Table form states
  const [startTime, setStartTime] = useState("08:30");
  const [wpNames, setWpNames] = useState<Record<number, string>>({});
  const [leaders, setLeaders] = useState<Record<number, string>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [routeRests, setRouteRests] = useState<Record<number, number>>({});
  const [cpRests, setCpRests] = useState<Record<number, number>>({});

  const schedule = useMemo(() => {
    const dep: string[] = [];
    const arr: string[] = [];
    if (!waypoints.length) return { dep, arr };
    
    dep[0] = startTime;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;
        const baseTime = (seg.distance / naismithSettings.baseSpeedKmh) * 60;
        const ascTime = (seg.ascent / 20) * naismithSettings.ascentPer20m;
        const descTime = (seg.descent / 20) * naismithSettings.descentPer20m;
        const walk = Math.round(baseTime + ascTime + descTime);

        const rRest = routeRests[i] || 0;
        const cRest = cpRests[i] || 0;

        const startMins = timeToMinutes(dep[i]);
        const arrMins = startMins + walk + rRest;
        arr[i] = minutesToTime(arrMins);

        if (i + 1 < waypoints.length) {
            dep[i + 1] = minutesToTime(arrMins + cRest);
        }
    }
    return { dep, arr };
  }, [waypoints.length, segments, startTime, routeRests, cpRests, naismithSettings]);

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

  useEffect(() => {
    if (externalDistance !== undefined && profile.length > 0) {
      setHoverX(externalDistance);
      // find closest point in profile for the tooltip
      let closest = profile[0];
      let minDiff = Math.abs(profile[0].distance - externalDistance);
      for (const p of profile) {
        const diff = Math.abs(p.distance - externalDistance);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }
      onHoverPoint(closest);
    }
  }, [externalDistance, profile, onHoverPoint]);

  // 🚀 監聽地圖同步：直接更新圖表懸停狀態
  useEffect(() => {
    const unsubscribe = hoverSync.subscribe((point, source) => {
      if (source === 'map' && point && profile.length > 0) {
        setHoverX(point.distance);
        // 尋找最接近的剖面點以觸發 Tooltip
        let closest = profile[0];
        let minDiff = Math.abs(profile[0].distance - point.distance);
        for (const p of profile) {
          const diff = Math.abs(p.distance - point.distance);
          if (diff < minDiff) {
            minDiff = diff;
            closest = p;
          }
        }
        onHoverPoint(closest);
      }
    });
    return unsubscribe;
  }, [profile, onHoverPoint]);

  const onMove = useCallback((e: any) => {
    if (e?.activePayload?.[0]) {
      const pt = e.activePayload[0].payload as ElevationProfilePoint;
      setHoverX(pt.distance);
      hoverSync.emit(pt, 'chart');     // 🚀 指定來源為 chart
    }
  }, []);

  const onClickChart = useCallback((e: any) => {
    if (e?.activePayload?.[0]) {
      const pt = e.activePayload[0].payload as ElevationProfilePoint;
      onPointClick(pt);
    }
  }, [onPointClick]);

  const onLeave = useCallback(() => {
    setHoverX(null);
    hoverSync.emit(null, 'chart');     // 🚀 指定來源為 chart
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
    if (waypoints.length < 2) return alert('請先建立路線！');

    try {
      const wb = XLSX.utils.book_new();
      const wsAOA: any[][] = [];

      wsAOA.push(["第二日"]);

      wsAOA.push([
        `地圖組別: ${headerInfo.mapGroup}`, "", 
        `編號及年份: ${headerInfo.year}`, "", "",
        `起點: ${wpNames[0] || ""}`, "", "", "", "", "", "", "",
        `終點: ${wpNames[waypoints.length - 1] || ""}`, "", "", "", "", "", "", "", "", "", "", "", ""
      ]);

      wsAOA.push([
        "路段", "CP", "地理名稱(出發)", "出發點\n(座標 50Q)", "CP", "地理名稱(到達)", "到達點\n(座標 50Q)",
        "起始高度", "分段\n上升", "累積\n上升", "分段\n下降", "累積\n下降", "累積\n上下降",
        "前視方向", "距離\n(km)", "累積距離\n(km)", 
        "步行\n(min)", "路線休息\n(min)", "CP休息\n(min)", "總需時\n(min)",
        "預計出發", "預計到達", "實際出發", "實際到達",
        "領航員", "備註"
      ]);

      let cumulativeDist = 0;
      let cumulativeAscent = 0;
      let cumulativeDescent = 0;

      for (let i = 0; i < waypoints.length - 1; i++) {
        const wp1 = waypoints[i];
        const wp2 = waypoints[i + 1];
        const seg = segments[i];
        
        cumulativeDist += seg.distance;
        cumulativeAscent += seg.ascent;
        cumulativeDescent += seg.descent;

        const coords1 = coordMode === 'grid' && materials && materials[i]?.grid ? materials[i].grid : `${wp1.latlng.lat.toFixed(4)}, ${wp1.latlng.lng.toFixed(4)}`;
        const coords2 = coordMode === 'grid' && materials && materials[i+1]?.grid ? materials[i+1].grid : `${wp2.latlng.lat.toFixed(4)}, ${wp2.latlng.lng.toFixed(4)}`;

        const baseTime = (seg.distance / naismithSettings.baseSpeedKmh) * 60;
        const ascTime = (seg.ascent / 20) * naismithSettings.ascentPer20m;
        const descTime = (seg.descent / 20) * naismithSettings.descentPer20m;
        const walk = Math.round(baseTime + ascTime + descTime);
        const rRest = routeRests[i] || 0;
        const cRest = cpRests[i] || 0;

        wsAOA.push([
          (i + 1).toString(),
          i === 0 ? 'SP' : `CP${i}`,
          wpNames[i] || "",
          coords1,
          i + 1 === waypoints.length - 1 ? 'EP' : `CP${i+1}`,
          wpNames[i+1] || "",
          coords2,
          Math.round((wp1 as any).elevation || 0),
          Math.round(seg.ascent),
          Math.round(cumulativeAscent),
          Math.round(seg.descent),
          Math.round(cumulativeDescent),
          Math.round(cumulativeAscent + cumulativeDescent),
          `${calculateBearing(wp1.latlng.lat, wp1.latlng.lng, wp2.latlng.lat, wp2.latlng.lng)}°`,
          seg.distance.toFixed(2),
          cumulativeDist.toFixed(2),
          walk,
          rRest,
          cRest,
          walk + rRest + cRest,
          schedule.dep[i] || "--:--",
          schedule.arr[i] || "--:--",
          "", 
          "", 
          leaders[i] || "",
          remarks[i] || ""
        ]);
      }

      wsAOA.push([]);
      wsAOA.push([]);

      const footerAOA = [
        ["【 📊 行程統計 (Stats) 】", "", "", "", "", "", ""],
        [
          "總距離：", `${stats?.totalDistance?.toFixed(2)} km`, "",
          "總上升 / 下降：", `+${stats?.totalAscent?.toFixed(0)} m / -${stats?.totalDescent?.toFixed(0)} m`, "",
          "最高高度：", `${stats?.maxElevation?.toFixed(0)} m`
        ],
        [
          "預計總時間：", formatMinutes(stats?.estimatedTime || 0), "",
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
          "🌑 月相：", weather ? String(weather.moonPhase).replace(/<\/?[^>]+(>|$)/g, "") : "--", "",
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
        { s: { r: 0, c: 0 }, e: { r: 0, c: 25 } }, 
        { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },  
        { s: { r: 1, c: 2 }, e: { r: 1, c: 4 } },  
        { s: { r: 1, c: 5 }, e: { r: 1, c: 12 } }, 
        { s: { r: 1, c: 13 }, e: { r: 1, c: 25 } }, 
      ];
      finalWs['!merges'] = merges;

      finalWs['!cols'] = [
        { wch: 6 },  { wch: 6 },  { wch: 18 }, { wch: 18 }, { wch: 6 },  { wch: 18 }, { wch: 18 }, 
        { wch: 10 }, { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 10 }, 
        { wch: 10 }, { wch: 10 }, { wch: 14 }, 
        { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, 
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, 
        { wch: 12 }, { wch: 20 }
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
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        
        {/* Top Left: Tabs & Inputs */}
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 rounded-lg p-1 shrink-0">
            <button onClick={() => setActiveTab('chart')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'chart' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>高度剖面</button>
            <button onClick={() => setActiveTab('table')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>路程計畫表</button>
          </div>
          {activeTab === 'chart' && (
            <div className="flex gap-4 text-xs border-l border-slate-700 pl-4">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">X軸(km):</span>
                <input type="number" step="0.1" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-16 text-white text-center outline-none focus:border-blue-500" value={xInterval} onChange={(e) => setXInterval(e.target.value)} placeholder="自動" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Y軸(m):</span>
                <input type="number" step="10" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-16 text-white text-center outline-none focus:border-blue-500" value={yInterval} onChange={(e) => setYInterval(e.target.value)} placeholder="自動" />
              </div>
            </div>
          )}
        </div>

        {/* Top Middle: Stats Panel */}
        <div className="flex gap-2 flex-wrap flex-1 justify-center shrink-0">
          <StatBadge label="總距離" val={`${stats?.totalDistance?.toFixed(2) || 0} km`} color="#a78bfa" />
          <StatBadge label="總上升" val={`+${stats?.totalAscent?.toFixed(0) || 0} m`} color="#34d399" />
          <StatBadge label="總下降" val={`-${stats?.totalDescent?.toFixed(0) || 0} m`} color="#fb7185" />
          <StatBadge label="最高高度" val={`${stats?.maxElevation?.toFixed(0) || 0} m`} color="#e2e8f0" />
          <StatBadge label="預計時間" val={formatMinutes(stats?.estimatedTime || 0)} color="#fcd34d" />
        </div>

        {/* Top Right: Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {activeTab === 'chart' ? (
            <button onClick={handleDownloadChartPNG} className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-3 py-1.5 rounded text-xs font-medium border border-blue-500/30 transition-colors">下載 PNG</button>
          ) : (
            <button onClick={handleExportExcel} className="bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded text-xs font-medium border border-green-500/30 transition-colors flex items-center gap-1">下載 EXCEL</button>
          )}
        </div>
      </div>

      {activeTab === 'chart' ? (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={profile} 
              onMouseMove={onMove} 
              onClick={onClickChart}
              onMouseLeave={onLeave} 
              margin={{ top: 20, right: 16, left: 0, bottom: 4 }}
            >
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
              <input value={headerInfo.region} onChange={e => setHeaderInfo({...headerInfo, region: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="地區..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">日期：</span>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">組員姓名：</span>
              <input value={headerInfo.team} onChange={e => setHeaderInfo({...headerInfo, team: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="姓名..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">地圖組別：</span>
              <input value={headerInfo.mapGroup} onChange={e => setHeaderInfo({...headerInfo, mapGroup: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="HM20C..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">編號及年份：</span>
              <input value={headerInfo.year} onChange={e => setHeaderInfo({...headerInfo, year: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="2024..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">領隊：</span>
              <input value={headerInfo.leader} onChange={e => setHeaderInfo({...headerInfo, leader: e.target.value})} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 overflow-x-auto flex-1 mb-4">
            <table className="w-full border-collapse text-[10px] min-w-[2400px]">
              <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
                <tr>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-10">路段</th>
                  <th colSpan={3} className="border border-slate-700 p-2 text-center text-blue-300">出發點</th>
                  <th colSpan={3} className="border border-slate-700 p-2 text-center text-rose-300">到達點</th>
                  <th colSpan={6} className="border border-slate-700 p-2 text-center text-emerald-400">高度 (m)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-14">前視<br/>方位</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">距離 (km)</th>
                  <th colSpan={4} className="border border-slate-700 p-2 text-amber-400 text-center">需時 (min)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-blue-400 text-center">預計時間</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-slate-400 text-center">實際時間 (手寫)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-20">領航員</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 min-w-[120px]">備註</th>
                </tr>
                <tr className="text-slate-400 font-normal">
                  <th className="border border-slate-700 p-1 w-10">CP</th>
                  <th className="border border-slate-700 p-1 w-24">名稱</th>
                  <th className="border border-slate-700 p-1 w-28 cursor-pointer hover:text-white" onClick={() => setCoordMode(coordMode === 'grid' ? 'latlng' : 'grid')}>座標<br/>(按此切換)</th>
                  <th className="border border-slate-700 p-1 w-10">CP</th>
                  <th className="border border-slate-700 p-1 w-24">名稱</th>
                  <th className="border border-slate-700 p-1 w-28">座標</th>
                  
                  <th className="border border-slate-700 p-1 w-12 text-slate-300">起始</th>
                  <th className="border border-slate-700 p-1 w-12 text-emerald-400">上升</th>
                  <th className="border border-slate-700 p-1 w-12 text-emerald-500">累積上升</th>
                  <th className="border border-slate-700 p-1 w-12 text-rose-400">下降</th>
                  <th className="border border-slate-700 p-1 w-12 text-rose-500">累積下降</th>
                  <th className="border border-slate-700 p-1 w-14 text-slate-300">累積上下降</th>
                  
                  <th className="border border-slate-700 p-1 w-12 text-purple-400">分段</th>
                  <th className="border border-slate-700 p-1 w-12 text-purple-500">累積</th>
                  
                  <th className="border border-slate-700 p-1 w-12 text-amber-300">步行</th>
                  <th className="border border-slate-700 p-1 w-14 text-amber-400">路線休息</th>
                  <th className="border border-slate-700 p-1 w-14 text-amber-400">CP休息</th>
                  <th className="border border-slate-700 p-1 w-14 text-amber-500">本段總計</th>
                  
                  <th className="border border-slate-700 p-1 w-16 text-blue-400">出發<br/>(首格可填)</th>
                  <th className="border border-slate-700 p-1 w-16 text-blue-400">到達</th>
                  
                  <th className="border border-slate-700 p-1 w-16">出發</th>
                  <th className="border border-slate-700 p-1 w-16">到達</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  if (waypoints.length < 2) return null;
                  let cumulativeDist = 0;
                  let cumulativeAscent = 0;
                  let cumulativeDescent = 0;

                  return Array.from({ length: waypoints.length - 1 }).map((_, i) => {
                    const wp1 = waypoints[i];
                    const wp2 = waypoints[i + 1];
                    const segment = segments[i];
                    if (!segment) return null;

                    cumulativeDist += segment.distance;
                    cumulativeAscent += segment.ascent;
                    cumulativeDescent += segment.descent;
                    
                    const baseTime = (segment.distance / naismithSettings.baseSpeedKmh) * 60;
                    const ascTime = (segment.ascent / 20) * naismithSettings.ascentPer20m;
                    const descTime = (segment.descent / 20) * naismithSettings.descentPer20m;
                    const walkMins = Math.round(baseTime + ascTime + descTime);

                    const isLastSeg = i === waypoints.length - 2;
                    const getCoords = (wp: WaypointMarker, idx: number) => {
                      if (coordMode === 'grid' && materials && materials[idx]?.grid) return materials[idx].grid;
                      return `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;
                    };

                    const rRest = routeRests[i] || 0;
                    const cRest = cpRests[i] || 0;

                    return (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20 text-center">
                        <td className="p-2 border border-slate-700 text-slate-300 font-bold">{i + 1}</td>
                        <td className="p-2 border border-slate-700 text-blue-400 font-bold">{i === 0 ? 'SP' : `CP${i}`}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" value={wpNames[i] || ''} onChange={(e) => setWpNames(prev => ({ ...prev, [i]: e.target.value }))} />
                        </td>
                        <td className="p-2 border border-slate-700 text-slate-400 font-mono text-[10px]">{getCoords(wp1, i)}</td>
                        
                        <td className="p-2 border border-slate-700 text-rose-400 font-bold">{isLastSeg ? 'EP' : `CP${i + 1}`}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input className="w-full bg-transparent p-2 outline-none text-white text-[11px]" value={wpNames[i + 1] || ''} onChange={(e) => setWpNames(prev => ({ ...prev, [i + 1]: e.target.value }))} />
                        </td>
                        <td className="p-2 border border-slate-700 text-slate-400 font-mono text-[10px]">{getCoords(wp2, i + 1)}</td>
                        
                        <td className="p-2 border border-slate-700 text-slate-300">{Math.round((wp1 as any).elevation || 0)}</td>
                        <td className="p-2 border border-slate-700 text-emerald-400">+{Math.round(segment.ascent)}</td>
                        <td className="p-2 border border-slate-700 text-emerald-500 opacity-80">+{Math.round(cumulativeAscent)}</td>
                        <td className="p-2 border border-slate-700 text-rose-400">-{Math.round(segment.descent)}</td>
                        <td className="p-2 border border-slate-700 text-rose-500 opacity-80">-{Math.round(cumulativeDescent)}</td>
                        <td className="p-2 border border-slate-700 text-slate-300 font-bold">{Math.round(cumulativeAscent + cumulativeDescent)}</td>
                        
                        <td className="p-2 border border-slate-700 text-amber-500 font-bold italic">{`${calculateBearing(wp1.latlng.lat, wp1.latlng.lng, wp2.latlng.lat, wp2.latlng.lng)}°`}</td>
                        
                        <td className="p-2 border border-slate-700 text-purple-400">{segment.distance.toFixed(2)}</td>
                        <td className="p-2 border border-slate-700 text-purple-500 opacity-80">{cumulativeDist.toFixed(2)}</td>
                        
                        <td className="p-2 border border-slate-700 font-bold text-amber-200 font-mono">{walkMins}</td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input type="number" className="w-full bg-transparent p-2 text-center outline-none text-amber-400 font-mono [appearance:textfield]" value={rRest || ''} onChange={(e) => { const val = parseInt(e.target.value) || 0; setRouteRests(prev => ({ ...prev, [i]: val })); }} />
                        </td>
                        <td className="p-0 border border-slate-700 bg-white/5">
                          <input type="number" className="w-full bg-transparent p-2 text-center outline-none text-amber-400 font-mono [appearance:textfield]" value={cRest || ''} onChange={(e) => { const val = parseInt(e.target.value) || 0; setCpRests(prev => ({ ...prev, [i]: val })); }} />
                        </td>
                        <td className="p-2 border border-slate-700 font-bold text-amber-500 font-mono">{walkMins + rRest + cRest}</td>
                        
                        <td className="p-0 border border-slate-700 bg-slate-900/50">
                          {i === 0 ? (
                            <input type="time" className="w-full bg-transparent p-2 text-center outline-none text-blue-300 font-mono font-bold" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                          ) : (
                            <div className="p-2 font-mono font-bold text-blue-300">{schedule.dep[i]}</div>
                          )}
                        </td>
                        <td className="p-2 border border-slate-700 font-bold font-mono text-blue-400">{schedule.arr[i]}</td>
                        
                        <td className="p-0 border border-slate-700 bg-white/5"><input className="w-full bg-transparent p-2 text-center outline-none text-slate-400 font-mono" placeholder="--:--" /></td>
                        <td className="p-0 border border-slate-700 bg-white/5"><input className="w-full bg-transparent p-2 text-center outline-none text-slate-400 font-mono" placeholder="--:--" /></td>
                        
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

          <div className="mt-auto grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800 shrink-0">
            <div className="space-y-2">
              <span className="text-red-400 text-[10px] uppercase font-bold flex items-center gap-1">☀️ 天文數據 (ASTRO)</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">日出/日落</span><span className="text-purple-400 text-xs">🌅 {weather ? `${weather.sunrise} / ${weather.sunset}` : "--:-- / --:--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月出/月落</span><span className="text-purple-400 text-xs">🌙 {weather ? `${weather.moonrise} / ${weather.moonset}` : "--:-- / --:--"}</span></div>
                <div className="flex flex-col"><span className="text-slate-500 text-[9px]">月相</span><span className="text-purple-400 text-xs">{weather ? String(weather.moonPhase).replace(/<\/?[^>]+(>|$)/g, "") : "--"}</span></div>
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
