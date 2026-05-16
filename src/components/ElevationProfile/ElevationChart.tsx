import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { ElevationProfilePoint, RouteStats, WaypointMarker, RouteSegment, NaismithSettings } from '../../types';
import { formatTime } from '../../hooks/useTerrainAnalysis';
import { calculateBearing } from '../../utils/coordUtils';
import { useItineraryData } from '../../hooks/useItineraryData';

// 🚀 引入新安裝的專業導出套件
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';

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
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });

  // 收納其餘輸入框狀態，用於 Excel 導出
  const [region, setRegion] = useState('');
  const [teamMembers, setTeamMembers] = useState('');
  const [mapGroup, setMapGroup] = useState('');
  const [mapYear, setMapYear] = useState('');
  const [leader, setLeader] = useState('');

  const { materials, weather } = useItineraryData(waypoints, segments, selectedDate);
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [hoverX, setHoverX] = useState<number | null>(null);
  const onHoverRef = useRef(onHoverPoint);
  onHoverRef.current = onHoverPoint;

  // 用於 PDF 擷取的 DOM 錨點
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

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

  // ─── 📑 功能 1：將當前畫面渲染並下載為 PDF ───
  const handleDownloadPDF = async () => {
    // 根據當前分頁決定擷取哪一個區塊
    const element = activeTab === 'chart' ? chartContainerRef.current : tableContainerRef.current;
    if (!element) return alert('找不到可導出的畫面內容！');

    try {
      // 使用 html2canvas 將 DOM 轉為 Canvas (設定高解析度 scale: 2)
      const canvas = await html2canvas(element, {
        useCORS: true,
        backgroundColor: '#0f172a', // 鎖定與 Slate-900 相同的暗色背景，防止透明外觀
        scale: 2,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      
      // 創立 A4 橫向 PDF 檔案
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // 保持比例計算圖表在 PDF 中的寬高
      const imgWidth = pdfWidth - 20; // 左右留 10mm 邊距
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // 防止高度溢出單頁 A4
      const finalHeight = imgHeight > pdfHeight - 20 ? pdfHeight - 20 : imgHeight;

      pdf.text(`山徑規劃報告 - ${activeTab === 'chart' ? '高度剖面圖' : '路程計畫表'}`, 10, 10);
      pdf.addImage(imgData, 'PNG', 10, 15, imgWidth, finalHeight);
      pdf.save(`山徑規劃紀錄-${activeTab}-${Date.now()}.pdf`);
    } catch (error) {
      console.error('PDF 產生失敗:', error);
      alert('產生 PDF 時發生錯誤！');
    }
  };

  // ─── 📊 功能 2：抓取精確資料結構，匯出真正的專業多欄位 EXCEL (.xlsx) ───
  const handleExportExcel = () => {
    // 1. 建立 Excel 頂部基本資訊工作表數據
    const infoData = [
      ["遠足地區", region, "日期", selectedDate, "組員姓名", teamMembers],
      ["地圖組別", mapGroup, "編號及年份", mapYear, "領隊", leader],
      [], // 空行
      ["統計指標", "總距離", "總爬升", "總下降", "最高點", "預計總時間"],
      ["數據值", `${stats.totalDistance.toFixed(2)} km`, `+${stats.totalAscent.toFixed(0)} m`, `-${stats.totalDescent.toFixed(0)} m`, `${stats.maxElevation.toFixed(0)} m`, formatTime(stats.estimatedTime)]
    ];

    // 2. 解析計算表格內部的路徑資料鏈 (對齊 UI 的計算邏輯)
    const tableRows = [
      [
        "檢查站", "地名 / 地理特徵", "網格座標 / 高度", "領航員", "前視方位", 
        "分段距離(KM)", "累積距離(KM)", "分段上升(M)", "累積上升(M)", "分段下降(M)", "累積下降(M)",
        "累積上下(M)", "路段需時(分)", "休息需時-路段", "休息需時-檢查點", "共需時(分)", 
        "預計出發", "預計到達", "備註/事工"
      ]
    ];

    // 時間計算鏈邏輯與 UI 渲染保持絕對一致
    const departureTimes: string[] = Array(waypoints.length).fill("--:--");
    const arrivalTimes: string[] = Array(waypoints.length).fill("--:--");
    departureTimes[0] = "08:30";

    const timeToMinutes = (tStr: string) => {
      const parts = tStr.split(":");
      return parts.length !== 2 ? 8 * 60 + 30 : (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
    };

    const minutesToTime = (mins: number) => {
      const h = Math.floor((mins % 1440) / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    // 縱向連續推導時間
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

    // 疊代注入每一列資料
    waypoints.forEach((wp, i) => {
      const segment = i < segments.length ? segments[i] : null;
      const isLastRow = i === waypoints.length - 1;

      const cumulativeDist = segments.slice(0, i + 1).reduce((sum, s) => sum + s.distance, 0);
      const cumulativeAscent = segments.slice(0, i + 1).reduce((sum, s) => sum + s.ascent, 0);
      const cumulativeDescent = segments.slice(0, i + 1).reduce((sum, s) => sum + s.descent, 0);
      
      const segmentMinutes = segment ? Math.round(
        (segment.distance / naismithSettings.baseSpeedKmh) * 60 +
        (segment.ascent / 20) * naismithSettings.ascentPer20m +
        (segment.descent / 20) * naismithSettings.descentPer20m
      ) : 0;

      const currentRouteRest = routeRests[i] || 0;
      const currentCpRest = cpRests[i] || 0;
      const totalMinutes = segmentMinutes + currentRouteRest + currentCpRest;

      const coordStr = (materials && materials[i]?.grid) ? materials[i].grid : `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;

      tableRows.push([
        i === 0 ? 'SP' : (isLastRow ? 'EP' : `CP${i}`),
        "", // 地名輸入留空供下載後填寫
        `${coordStr} / ${(wp as any).elevation || 0}m`,
        "", // 領航員
        segment && waypoints[i + 1] ? `${calculateBearing(wp.latlng.lat, wp.latlng.lng, waypoints[i + 1].latlng.lat, waypoints[i + 1].latlng.lng)}°` : "--°",
        !isLastRow && segment ? segment.distance.toFixed(2) : "0.00",
        !isLastRow && segment ? cumulativeDist.toFixed(2) : "0.00",
        !isLastRow && segment ? `+${segment.ascent.toFixed(0)}` : "+0",
        !isLastRow && segment ? `+${cumulativeAscent.toFixed(0)}` : "+0",
        !isLastRow && segment ? `-${segment.descent.toFixed(0)}` : "-0",
        !isLastRow && segment ? `-${cumulativeDescent.toFixed(0)}` : "-0",
        !isLastRow && segment ? (segment.ascent + segment.descent).toFixed(0) : "0",
        (!isLastRow ? segmentMinutes : 0).toString(),
        (currentRouteRest).toString(),
        (currentCpRest).toString(),
        (isLastRow ? 0 : totalMinutes).toString(),
        departureTimes[i],
        isLastRow ? arrivalTimes[i - 1] || "--:--" : arrivalTimes[i],
        "" // 備註
      ]);
    });

    // 3. 建立工作簿物件 (Workbook) 並結合多個區塊
    const wb = XLSX.utils.book_new();
    
    // 合併 基本資料 與 主計畫表 資料
    const finalSheetData = [...infoData, [], ["--- 主路程計畫表 ---"], ...tableRows];
    const ws = XLSX.utils.aoa_to_sheet(finalSheetData);

    // 4. 設定欄寬優化 Excel 可讀性
    ws['!cols'] = [
      { wch: 8 }, { wch: 22 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, 
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 20 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "山徑計畫表");
    XLSX.writeFile(wb, `精細山徑路程計畫表-${Date.now()}.xlsx`);
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

        {/* 🟢 頂部動態控制面板：提供下載「當前畫面 PDF」與「導出真實美化 Excel」 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPDF}
            className="px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-bold transition-all shadow-sm"
          >
            📄 下載 PDF 報告
          </button>
          <button
            onClick={handleExportExcel}
            className="px-2.5 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-[11px] font-bold transition-all shadow-sm"
          >
            📊 匯出完整 EXCEL
          </button>
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
        /* 📸 高度剖面圖容器 */
        <div ref={chartContainerRef} className="flex-1 min-h-0 p-2 bg-slate-900 rounded-lg">
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
        /* 📸 計畫表容器 - 用於 PDF 全畫面綁定 */
        <div ref={tableContainerRef} className="overflow-x-auto flex-1 flex flex-col gap-4 p-2 bg-slate-900 rounded-lg">
          {/* 1. 行程基本資訊欄位 (綁定雙向 state 以利 Excel 導出讀取資料) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 p-3 bg-slate-900/80 rounded-lg border border-slate-700 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">遠足地區：</span>
              <input value={region} onChange={e => setRegion(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="請輸入..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">日期：</span>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">組員姓名：</span>
              <input value={teamMembers} onChange={e => setTeamMembers(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="姓名..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">地圖組別：</span>
              <input value={mapGroup} onChange={e => setMapGroup(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="HM20C..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">編號及年份：</span>
              <input value={mapYear} onChange={e => setMapYear(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" placeholder="2024..." />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400 whitespace-nowrap">領隊：</span>
              <input value={leader} onChange={e => setLeader(e.target.value)} className="bg-transparent border-b border-slate-700 w-full outline-none text-white focus:border-blue-500" />
            </div>
          </div>

          {/* 2. 主表格 */}
          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full border-collapse text-[11px] min-w-[1550px]">
              <thead className="bg-slate-900 sticky top-0 z-10 text-red-400">
                <tr>
                  <th rowSpan={2} className="border border-slate-700 p-2 w-16">檢查站</th>
                  <th className="border border-slate-700 p-2 text-left w-64">地名 / 地理特特征</th>
                  <th className="border border-slate-700 p-2 w-40">網格座標(經緯) / 高度</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-center w-16">領航員</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-center w-16">前視<br/>方位</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">距離 (KM)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">上升 (M)</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center">下降 (M)</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-emerald-400 text-center w-20">累積上升<br/>及下降</th>
                  <th rowSpan={2} className="border border-slate-700 p-2 text-purple-400 text-center w-20">路段需時<br/>分鐘</th>
                  <th colSpan={2} className="border border-slate-700 p-2 text-center">休息及事工需時 (MIN)</th>
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
                          <div 
                            onClick={() => setCoordMode(coordMode === 'grid' ? 'latlng' : 'grid')}
                            className="text-purple-400 font-bold text-[11px] mb-1 cursor-pointer hover:text-purple-300 select-none"
                          >
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
                          {segment && waypoints[i + 1] ? `${calculateBearing(wp.latlng.lat, wp.latlng.lng, waypoints[i + 1].latlng.lat, waypoints[i + 1].latlng.lng)}°` : "--°"}
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
                        <td className="p-2 border border-slate-700 text-center font-bold text-purple-400 font-mono">
                          {!isLastRow ? segmentMinutes : 0}
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
                        <td className="p-2 border border-slate-700 text-center font-bold text-amber-400 font-mono">
                          {isLastRow ? 0 : totalMinutes}
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
