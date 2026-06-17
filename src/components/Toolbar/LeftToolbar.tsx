import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RouteIcon, Undo2, Trash2, Upload, Download, Map, Layers, Satellite, Footprints, ChevronRight, ChevronLeft, Search } from 'lucide-react';
import { MapLayer } from '../../types';

interface Props {
  routingMode: 'hiking' | 'straight';
  onRoutingMode: (m: 'hiking' | 'straight') => void;
  mapLayer: MapLayer;
  onMapLayer: (l: MapLayer) => void;
  onUndo: () => void;
  onClear: () => void;
  onImportGPX: () => void;
  onExportGPX: () => void;
  hasRoute: boolean;
  isProcessing: boolean;
  onSearchCoord: (coord: string) => Promise<void>;
}

export default function LeftToolbar({
  routingMode, onRoutingMode,
  mapLayer, onMapLayer,
  onUndo, onClear, onImportGPX, onExportGPX,
  hasRoute, isProcessing,
  onSearchCoord,
}: Props) {
  // 🟢 控制左側工具列本身是否收合的狀態
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchVal, setSearchVal] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchVal.trim()) return;
    await onSearchCoord(searchVal);
    setIsSearching(false);
    setSearchVal('');
  };

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-[1000] flex items-center gap-2">
      {/* 🟢 搜尋輸入框 (當 isSearching 為 true 時顯示) */}
      <AnimatePresence>
        {isSearching && (
          <motion.form
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            onSubmit={handleSearch}
            className="absolute left-16 flex items-center gap-2"
            style={{
              background: 'rgba(8,14,28,0.94)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: 12,
              padding: '6px 12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 1001
            }}
          >
            <input
              autoFocus
              className="bg-transparent text-white text-xs outline-none w-48 font-mono"
              placeholder="Lat, Lng 或 8位座標..."
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              onBlur={() => {
                // Delay closing to allow submit
                setTimeout(() => setIsSearching(false), 200);
              }}
            />
            <button type="submit" className="text-emerald-400 hover:text-emerald-300 p-1">
              <Search size={14} />
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* 🟢 工具列本體（帶有平滑滑出動畫） */}
      <AnimatePresence mode="wait">

        {!isCollapsed && (
          <motion.div
            initial={{ x: -60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex flex-col gap-1"
            style={{
              background: 'rgba(8,14,28,0.94)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(148,163,184,0.12)',
              borderRadius: 14,
              padding: '8px 6px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
            }}
          >
            {/* 路由模式 */}
            <Group label="路由">
              <Btn
                icon={<Footprints size={16} />}
                label="山徑路由 (BRouter hiking-mountain)"
                active={routingMode === 'hiking'}
                onClick={() => onRoutingMode('hiking')}
                color="emerald"
              />
              <Btn
                icon={<RouteIcon size={16} />}
                label="直線模式 (SRTM 高度補償)"
                active={routingMode === 'straight'}
                onClick={() => onRoutingMode('straight')}
                color="amber"
              />
            </Group>

            <Divider />

            {/* 地圖圖層 */}
            <Group label="圖層">
              <Btn icon={<Map size={15} />}      label="街道圖 (OSM)"  active={mapLayer === 'osm'}       onClick={() => onMapLayer('osm')}       color="slate" small />
              <Btn icon={<Layers size={15} />}   label="地形圖 (Topo)" active={mapLayer === 'topo'}      onClick={() => onMapLayer('topo')}      color="slate" small />
              <Btn icon={<Satellite size={15} />} label="衛星圖 (Esri)" active={mapLayer === 'satellite'} onClick={() => onMapLayer('satellite')} color="slate" small />
            </Group>

            <Divider />

            {/* 操作 */}
            <Group label="操作">
              <Btn icon={<Search size={15} />}   label="座標搜尋"  onClick={() => setIsSearching(true)} color="slate" small />
              <Btn icon={<Undo2 size={15} />}    label="撤銷上一段"  onClick={onUndo}       color="slate" small disabled={!hasRoute} />
              <Btn icon={<Trash2 size={15} />}   label="清除全部"    onClick={onClear}      color="rose"  small disabled={!hasRoute} />
              <Btn icon={<Upload size={15} />}   label="匯入 GPX"   onClick={onImportGPX}  color="slate" small />
              <Btn icon={<Download size={15} />} label="匯出 GPX"   onClick={onExportGPX}  color="slate" small disabled={!hasRoute} />
            </Group>

            {/* Processing dot */}
            {isProcessing && (
              <div className="flex justify-center pt-1">
                <motion.div
                  className="w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🟢 核心：收摺/展開小按鈕（永遠留在畫面上供點擊） */}
      <motion.button
        onClick={() => setIsCollapsed(!isCollapsed)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title={isCollapsed ? "展開工具列" : "收合工具列"}
        className="w-5 h-12 rounded-r-md flex items-center justify-center border transition-all text-slate-400 border-slate-700/50 hover:text-white hover:bg-slate-800/60"
        style={{
          background: 'rgba(8,14,28,0.85)',
          backdropFilter: 'blur(10px)',
          borderLeft: 'none'
        }}
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </motion.button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-slate-600 text-[8px] font-mono uppercase tracking-widest text-center">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-700/50 mx-1 my-0.5" />;
}

type BtnColor = 'emerald' | 'amber' | 'slate' | 'rose';

const COLORS: Record<BtnColor, { active: string; hover: string }> = {
  emerald: { active: 'bg-emerald-500/25 border-emerald-500/50 text-emerald-300', hover: 'hover:bg-emerald-500/15 hover:text-emerald-400' },
  amber:   { active: 'bg-amber-500/25  border-amber-500/50  text-amber-300',     hover: 'hover:bg-amber-500/15  hover:text-amber-400' },
  slate:   { active: 'bg-slate-600/40  border-slate-500/40  text-slate-200',     hover: 'hover:bg-slate-700/40  hover:text-slate-300' },
  rose:    { active: 'bg-rose-500/25   border-rose-500/50   text-rose-300',      hover: 'hover:bg-rose-500/15   hover:text-rose-400' },
};

function Btn({ icon, label, active = false, onClick, color = 'slate', small = false, disabled = false }: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  color?: BtnColor;
  small?: boolean;
  disabled?: boolean;
}) {
  const c  = COLORS[color];
  const sz = small ? 'w-8 h-8' : 'w-9 h-9';
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      title={label}
      whileHover={!disabled ? { scale: 1.08 } : {}}
      whileTap={!disabled  ? { scale: 0.93 } : {}}
      className={`${sz} rounded-lg flex items-center justify-center border transition-all ${
        disabled ? 'opacity-25 cursor-not-allowed border-transparent text-slate-600'
        : active  ? `${c.active} shadow-sm`
        : `border-transparent text-slate-500 ${c.hover}`
      }`}
    >
      {icon}
    </motion.button>
  );
}
