import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Route, Mountain, Clock, AlertCircle, Info, Trash2 } from 'lucide-react';
import { RouteStats as RouteStatsType, RouteSegment, WaypointMarker, NaismithSettings } from '../../types';
import { formatTime } from '../../hooks/useTerrainAnalysis';

interface Props {
  stats: RouteStatsType;
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  onDeleteWaypoint: (index: number) => void;
  /** 滑鼠移到 CP 行 → 地圖上亮起該路點；離開清空 */
  onHighlightWaypoint?: (index: number | null) => void;
  highlightWaypoint?: number | null;
  naismithSettings: NaismithSettings;
  onNaismithChange: (s: NaismithSettings) => void;
  isProcessing: boolean;
  error: string | null;
}

export default function RightPanel({
  stats, segments, waypoints, onDeleteWaypoint,
  onHighlightWaypoint, highlightWaypoint = null,
  naismithSettings, onNaismithChange, isProcessing, error,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute right-0 top-0 h-full z-[1000] flex items-stretch">
      {/* Toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="self-center w-5 h-14 flex items-center justify-center rounded-l-lg transition-colors hover:bg-slate-700/30"
        style={{
          background: 'rgba(8,14,28,0.94)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(148,163,184,0.12)',
          borderRight: 'none',
        }}
      >
        {collapsed
          ? <ChevronLeft  size={12} className="text-slate-400" />
          : <ChevronRight size={12} className="text-slate-400" />}
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="rp"
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0,   opacity: 1 }}
            exit={{   x: 300, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="w-72 h-full flex flex-col overflow-hidden"
            style={{
              background: 'rgba(8,14,28,0.94)',
              backdropFilter: 'blur(24px)',
              borderLeft: '1px solid rgba(148,163,184,0.12)',
              boxShadow: '-4px 0 32px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-700/40 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center">
                <Mountain size={13} className="text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-sm">ReliefForge Pro</h1>
                <p className="text-slate-500 text-[9px] tracking-widest">山徑分析系統</p>
              </div>
              {isProcessing && (
                <div className="ml-auto flex gap-0.5">
                  {[0, 1, 2].map(i => (
                    <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mx-3 mt-2 flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-1.5">
                <AlertCircle size={11} className="text-amber-400" />
                <span className="text-amber-400 text-[10px]">{error}</span>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-5">
              <RouteStatsPanel
                stats={stats}
                segments={segments}
                waypoints={waypoints}
                onDeleteWaypoint={onDeleteWaypoint}
                onHighlightWaypoint={onHighlightWaypoint}
                highlightWaypoint={highlightWaypoint}
                settings={naismithSettings}
                onChange={onNaismithChange}
                isProcessing={isProcessing}
              />
            </div>

            {/* Footer — 底部預留空間，避開右下角 SCOUT「🐛💬 回報 · 意見」浮動按鈕
                （widget: #scoutw-fab, position:fixed; right:18px; bottom:18px; 高約 38px，
                頂端約在畫面底部 56px 處，會蓋住面板底部的版權文字） */}
            <div className="px-4 pt-2 pb-16 border-t border-slate-700/40">
              <p className="text-slate-600 text-[8px] font-mono text-center tracking-widest">
                Copyright 2026 SCOUT SYSTEM. ALL RIGHTS RESERVED.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Route stats + Naismith ────────────────────────────────────────────────
function RouteStatsPanel({ stats, segments, waypoints, onDeleteWaypoint, onHighlightWaypoint, highlightWaypoint, settings, onChange, isProcessing }: {
  stats: RouteStatsType;
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  onDeleteWaypoint: (index: number) => void;
  onHighlightWaypoint?: (index: number | null) => void;
  highlightWaypoint?: number | null;
  settings: NaismithSettings;
  onChange: (s: NaismithSettings) => void;
  isProcessing: boolean;
}) {
  return (
    <>
      {/* Data source note */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
        <Info size={12} className="text-emerald-400 mt-0.5 shrink-0" />
        <p className="text-emerald-400/80 text-[10px] leading-relaxed">
          路線由 <strong>BRouter hiking-mountain</strong> 計算，優先走山徑、步道。
          高度資料來自 <strong>SRTM 90m</strong>。
        </p>
      </div>

      {/* Stats grid */}
      <Section title="路線統計" icon={<Route size={12} />}>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <StatCard label="總距離" val={`${stats.totalDistance.toFixed(2)} km`} color="#60a5fa" />
          <StatCard label="預計時間" val={formatTime(stats.estimatedTime)} color="#a78bfa" />
          <StatCard label="總爬升" val={`+${stats.totalAscent.toFixed(0)} m`} color="#34d399" />
          <StatCard label="總下降" val={`-${stats.totalDescent.toFixed(0)} m`} color="#f87171" />
          <StatCard label="最高點" val={`${stats.maxElevation.toFixed(0)} m`} color="#fbbf24" />
          <StatCard label="最低點" val={`${stats.minElevation.toFixed(0)} m`} color="#22d3ee" />
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-slate-700/40">
          <Clock size={11} className="text-violet-400" />
          <span className="text-slate-400 text-[11px]">Naismith 預計</span>
          <span className="ml-auto text-violet-300 text-sm font-mono font-bold">
            {formatTime(stats.estimatedTime)}
          </span>
        </div>
      </Section>

      {/* Naismith settings */}
      <Section title="Naismith 時間算法" icon={<Clock size={12} />}>
        <div className="space-y-3">
          <SR label="基礎時速" unit="km/h" val={settings.baseSpeedKmh} min={1} max={8} step={0.5}
            onChange={v => onChange({ ...settings, baseSpeedKmh: v })} />
          <SR label="每上升 20m 加時" unit="分" val={settings.ascentPer20m} min={1} max={20} step={0.5}
            onChange={v => onChange({ ...settings, ascentPer20m: v })} />
          <SR label="每下降 20m 加時" unit="分" val={settings.descentPer20m} min={0} max={10} step={0.5}
            onChange={v => onChange({ ...settings, descentPer20m: v })} />
        </div>
        <p className="text-slate-600 text-[10px] mt-2 leading-relaxed">
          預設值適合一般山徑健行。急升路段建議每 20m 設為 8–10 分。
        </p>
      </Section>

      {/* Waypoint list with delete buttons */}
      {waypoints.length > 0 && (
        <Section title="檢查點 (CP)" icon={<Route size={12} />}>
          <p className="text-slate-500 text-[10px] leading-relaxed mb-2">
            💡 改位置：<span className="text-slate-400">① 拖地圖上的 CP 手柄 · ② 拖橫切面嘅 CP 點 · ③ 改路程表座標</span>
            <br />滑過下面任何一行，地圖上對應嘅 CP 會亮起。
          </p>
          <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
            {waypoints.map((wp, i) => {
              const isStart = wp.type === 'start';
              const isEnd   = wp.type === 'end';
              const label   = isStart ? '起點' : isEnd ? '終點' : `CP ${i}`;
              const dotColor = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#f59e0b';
              // Segment after this waypoint (if any)
              const seg = segments[i] ?? null;
              return (
                <div
                  key={wp.id}
                  onMouseEnter={() => onHighlightWaypoint?.(i)}
                  onMouseLeave={() => onHighlightWaypoint?.(null)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border group transition-colors ${
                    highlightWaypoint === i
                      ? 'bg-blue-500/10 border-blue-500/40'
                      : 'bg-slate-800/40 border-slate-700/20'
                  }`}
                >
                  {/* Colour dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}` }}
                  />

                  {/* Label + elevation */}
                  <div className="flex flex-col min-w-0">
                    <span className="text-slate-200 text-[11px] font-medium leading-tight">{label}</span>
                    <span className="text-slate-500 text-[9px] font-mono">
                      {wp.elevation.toFixed(0)} m · {wp.latlng.lat.toFixed(5)}, {wp.latlng.lng.toFixed(5)}
                    </span>
                  </div>

                  {/* Segment stats (distance to next CP) */}
                  {seg && (
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-500 text-[9px] font-mono">{seg.distance.toFixed(2)} km</span>
                      <span className="text-emerald-400 text-[9px] font-mono">↑{seg.ascent.toFixed(0)}m</span>
                      <span className="text-rose-400 text-[9px] font-mono">↓{seg.descent.toFixed(0)}m</span>
                    </div>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={() => onDeleteWaypoint(i)}
                    disabled={isProcessing}
                    title={`刪除 ${label}`}
                    className="
                      ml-1 w-6 h-6 rounded-md shrink-0
                      flex items-center justify-center
                      text-slate-600 hover:text-rose-400
                      hover:bg-rose-500/15
                      border border-transparent hover:border-rose-500/30
                      transition-all opacity-0 group-hover:opacity-100
                      disabled:cursor-not-allowed disabled:opacity-30
                    "
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────
function Section({ title, icon, children }: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-emerald-500/60">{icon}</span>
        <span className="text-slate-400 text-[11px] font-medium tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/30">
      <span className="text-slate-500 text-[9px] uppercase tracking-wide">{label}</span>
      <span className="font-mono font-semibold text-sm" style={{ color }}>{val}</span>
    </div>
  );
}

function SR({ label, unit, val, min, max, step, onChange }: {
  label: string; unit: string; val: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-slate-400 text-[11px]">{label}</span>
        <span className="text-blue-400 text-[11px] font-mono">{val} {unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer accent-blue-500"
      />
    </div>
  );
}
