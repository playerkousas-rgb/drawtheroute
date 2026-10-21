import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, FileImage, AlertTriangle, Loader2 } from 'lucide-react';
import L from 'leaflet';
import type { MapLayer, RouteSegment, WaypointMarker } from '../../types';
import {
  exportMapImage, exportRoutePages, downloadBlob, planRoutePages, densify, flattenRoute,
  boundsGroundSizeM, pxPerMeterForScale, denominatorFor,
  type TileSource,
} from '../../lib/mapImageExport';

/* ── 底圖元資料（credit 必須跟條款；hm20c = LandsD TNC 要求） ── */
const LAYER_META: Record<MapLayer, TileSource & { credit: string; name: string }> = {
  osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                            maxZoom: 19, credit: '© OpenStreetMap',          name: '街道圖' },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                                              maxZoom: 17, credit: '© OpenTopoMap',            name: '地形圖' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, credit: 'Imagery © Esri, Maxar, GeoEye', name: '衛星圖' },
  hm20c:     { url: 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png',                  maxZoom: 20, credit: 'Map from Lands Department', name: 'HM20C 地形圖' },
};

const PAPERS = {
  A3L: { label: 'A3 橫向', mm: [420, 297] },
  A3P: { label: 'A3 直向', mm: [297, 420] },
  A4L: { label: 'A4 橫向', mm: [297, 210] },
  A4P: { label: 'A4 直向', mm: [210, 297] },
} as const;
type PaperKey = keyof typeof PAPERS;

type Scope = 'fit' | 'viewport' | 'scale' | 'pages';

interface Props {
  open: boolean;
  onClose: () => void;
  map: L.Map | null;
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  mapLayer: MapLayer;
}

const NOTE_TEXT = '⚠ 路線為規劃／實測線，部分路段可能未見於地形圖，行進以實地為準';
/** 高於呢個比例分母就警告「只可作總覽」 */
const OVERVIEW_ONLY = 40000;

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export default function MapExportDialog({ open, onClose, map, segments, waypoints, mapLayer }: Props) {
  const [scope, setScope] = useState<Scope>('fit');
  const [paper, setPaper] = useState<PaperKey>('A3L');
  // 以電腦為主、手機可用：預設列印級 300dpi（不為手機降級預設）
  const [dpi, setDpi] = useState(300);
  const [denom, setDenom] = useState(20000);
  const [overlayOsm, setOverlayOsm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');

  const hasRoute = segments.length > 0 && segments.some(s => s.points.length >= 2);

  // 路線地面尺寸（估算警告用）
  const routeSize = useMemo(() => {
    const pts = segments.flatMap(s => s.points);
    if (!pts.length) return null;
    const b = L.latLngBounds(pts.map(p => [p.lat, p.lng] as [number, number]));
    return boundsGroundSizeM(b);
  }, [segments]);

  const [pw, ph] = PAPERS[paper].mm;
  const widthPx = Math.round((pw / 25.4) * dpi);
  const heightPx = Math.round((ph / 25.4) * dpi);
  const isScaleMode = scope === 'scale' || scope === 'pages';
  const ppm = isScaleMode ? pxPerMeterForScale(denom, dpi) : 0;
  const coverWm = isScaleMode ? widthPx / ppm : 0;
  const coverHm = isScaleMode ? heightPx / ppm : 0;

  const pageCount = useMemo(() => {
    if (scope !== 'pages' || !hasRoute) return 0;
    const flat = densify(flattenRoute(segments));
    return planRoutePages(flat, coverWm, coverHm).length;
  }, [scope, hasRoute, segments, coverWm, coverHm]);

  // 自動 fit 的預計比例
  const fitDenom = useMemo(() => {
    if (scope !== 'fit' || !routeSize || !map) return 0;
    // 路線 bbox 加 margin 咁 fit 入張紙：ppm ≈ min(W/wM, H/hM)（Mercator 變形誤差 <5%，顯示「約」）
    const pad = 1.15;
    const ppmEst = Math.min(widthPx / (routeSize.wM * pad), heightPx / (routeSize.hM * pad));
    return denominatorFor(ppmEst, dpi);
  }, [scope, routeSize, map, widthPx, heightPx, dpi]);

  const viewportDenom = useMemo(() => {
    if (scope !== 'viewport' || !map) return 0;
    const size = boundsGroundSizeM(map.getBounds());
    return denominatorFor(widthPx / Math.max(1, size.wM), dpi);
  }, [scope, map, widthPx, dpi]);

  const previewLines = useMemo(() => {
    const lines: Array<{ text: string; warn?: boolean }> = [];
    if (!hasRoute && scope !== 'viewport') {
      lines.push({ text: '未有路線——請先規劃路線，或改用「當前視窗」模式', warn: true });
      return lines;
    }
    if (scope === 'fit') {
      lines.push({ text: `自動 fit 全線 → 輸出約 1:${fmtNum(fitDenom)}（${PAPERS[paper].label} ${dpi}dpi ≈ ${widthPx}×${heightPx}px）` });
      if (fitDenom > OVERVIEW_ONLY) {
        lines.push({ text: `⚠ 約 1:${fmtNum(fitDenom)} 偏細，只可作路線總覽；行軍用圖請用「固定比例＋自動分段」`, warn: true });
      } else {
        lines.push({ text: '✓ 呢個比例接近實體地圖，可作行軍參考' });
      }
    } else if (scope === 'viewport') {
      lines.push({ text: `所見即所得（目前視窗）→ 輸出約 1:${fmtNum(viewportDenom)}（${dpi}dpi）` });
    } else if (scope === 'scale') {
      lines.push({ text: `固定 1:${fmtNum(denom)}（${PAPERS[paper].label} ${dpi}dpi）→ 覆蓋約 ${(coverWm / 1000).toFixed(1)} × ${(coverHm / 1000).toFixed(1)} km` });
      if (routeSize) {
        const wKm = routeSize.wM / 1000, hKm = routeSize.hM / 1000;
        if (routeSize.wM > coverWm * 1.02 || routeSize.hM > coverHm * 1.02) {
          lines.push({ text: `⚠ 路線整體約 ${wKm.toFixed(1)} × ${hKm.toFixed(1)} km，單頁裝唔落——建議改用「固定比例＋自動分段」`, warn: true });
        } else {
          lines.push({ text: `✓ 路線約 ${wKm.toFixed(1)} × ${hKm.toFixed(1)} km，單頁覆蓋到` });
        }
      }
      lines.push({ text: '列印時揀「實際大小 / 100%」＝精確 1:' + fmtNum(denom) });
    } else {
      lines.push({ text: `固定 1:${fmtNum(denom)}＋自動分段（${PAPERS[paper].label} ${dpi}dpi，頁間 20% 重疊）` });
      lines.push({ text: `將輸出 ${pageCount} 頁（沿路線次序，每頁高亮該段路線）`, warn: pageCount === 0 });
      lines.push({ text: '瀏覽器會詢問「允許多個下載」——請按允許' });
      lines.push({ text: '列印時揀「實際大小 / 100%」＝精確 1:' + fmtNum(denom) });
    }
    return lines;
  }, [scope, hasRoute, fitDenom, viewportDenom, denom, paper, dpi, widthPx, heightPx, coverWm, coverHm, routeSize, pageCount]);

  const canExport = hasRoute || scope === 'viewport';

  const attributionFor = (): string[] => {
    const meta = LAYER_META[mapLayer];
    const arr = [meta.credit];
    if (overlayOsm) arr.push('© OpenStreetMap');
    arr.push('© 香港特別行政區政府地政總署／各底圖提供者');
    return arr;
  };

  const buildBase = () => {
    const meta = LAYER_META[mapLayer];
    return {
      widthPx, heightPx, dpi,
      pxPerMeter: isScaleMode ? ppm : undefined,
      base: { url: meta.url, maxZoom: meta.maxZoom },
      overlay: overlayOsm ? {
        source: { url: LAYER_META.osm.url, maxZoom: LAYER_META.osm.maxZoom },
        alpha: 0.45,
      } : undefined,
      segments, waypoints,
      title: '路線地圖',
      subtitle: `${meta.name}${overlayOsm ? ' ＋ OSM 山徑疊圖' : ''} · 產生日期 ${new Date().toLocaleDateString('zh-HK')}`,
      scaleText: isScaleMode ? `比例 1:${fmtNum(denom)}（100% 列印）` : `比例約 1:${fmtNum(scope === 'fit' ? fitDenom : viewportDenom)}`,
      noteText: NOTE_TEXT,
      attribution: attributionFor(),
    };
  };

  const boundsOf = (): L.LatLngBounds => {
    if (scope === 'viewport' && map) return map.getBounds();
    const pts = segments.flatMap(s => s.points);
    const b = L.latLngBounds(pts.map(p => [p.lat, p.lng] as [number, number]));
    // 路線 bbox 留 8% 邊位
    const dLat = (b.getNorth() - b.getSouth()) * 0.08 || 0.01;
    const dLng = (b.getEast() - b.getWest()) * 0.08 || 0.01;
    return L.latLngBounds([b.getSouth() - dLat, b.getWest() - dLng], [b.getNorth() + dLat, b.getEast() + dLng]);
  };

  const handleExport = async () => {
    if (busy || !canExport) return;
    setErr('');
    setBusy(true);
    try {
      const base = buildBase();
      const date = new Date().toISOString().slice(0, 10);
      if (scope === 'pages') {
        const flat = densify(flattenRoute(segments));
        const pages = planRoutePages(flat, coverWm, coverHm);
        if (!pages.length) throw new Error('分頁失敗——路線太短或數據唔完整');
        await exportRoutePages(
          base, pages,
          (i, n) => `路線地圖_${denom}-p${i}of${n}_${date}.png`,
          setProgress,
        );
      } else {
        setProgress('載入圖磚…');
        const res = await exportMapImage({
          ...base,
          bounds: boundsOf(),
          title: scope === 'viewport' ? '路線地圖（當前視窗）' : '路線地圖',
          onProgress: (d, t) => setProgress(`載入圖磚 ${d}/${t}…`),
        });
        downloadBlob(res.blob, `路線地圖_1-${res.scaleDenominator}_${date}.png`);
      }
      setProgress('完成 ✓');
      setTimeout(() => { setProgress(''); onClose(); }, 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '匯出失敗');
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
          <motion.div
            className="w-full max-w-[520px] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
          >
            {/* 標題列 */}
            <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
              <div className="flex items-center gap-2 text-slate-100">
                <FileImage size={17} className="text-emerald-400" />
                <span className="text-sm font-bold">下載路線地圖（PNG）</span>
              </div>
              <button onClick={onClose} disabled={busy}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 text-xs">
              {/* 範圍 */}
              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">範圍</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <ScopeBtn active={scope === 'fit'} onClick={() => setScope('fit')} label="整條路線（自動 fit）" sub="一鍵全線總覽圖" />
                  <ScopeBtn active={scope === 'viewport'} onClick={() => setScope('viewport')} label="當前視窗" sub="所見即所得／手動分段" />
                  <ScopeBtn active={scope === 'scale'} onClick={() => setScope('scale')} label="固定比例單頁" sub="100% 列印＝該比例" />
                  <ScopeBtn active={scope === 'pages'} onClick={() => setScope('pages')} label="固定比例＋自動分段" sub="多日長線行軍圖 ★" />
                </div>
              </div>

              {/* 比例（固定模式）／自動顯示 */}
              {isScaleMode ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">比例</span>
                  {[20000, 25000, 40000].map(d => (
                    <button key={d} onClick={() => setDenom(d)}
                      className={`rounded-md px-2.5 py-1.5 font-semibold transition ${denom === d ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500'}`}>
                      1:{fmtNum(d)}
                    </button>
                  ))}
                  <span className="text-slate-500">（HM20C ＝ 1:20,000）</span>
                </div>
              ) : null}

              {/* 紙張／精度 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400">輸出</span>
                {(Object.keys(PAPERS) as PaperKey[]).map(k => (
                  <button key={k} onClick={() => setPaper(k)}
                    className={`rounded-md px-2 py-1.5 transition ${paper === k ? 'bg-sky-500/20 text-sky-300 border border-sky-400/50' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500'}`}>
                    {PAPERS[k].label}
                  </button>
                ))}
                <select value={dpi} onChange={e => setDpi(Number(e.target.value))}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-slate-300 outline-none">
                  <option value={300}>300 dpi（列印）</option>
                  <option value={200}>200 dpi（快）</option>
                </select>
              </div>

              {/* 疊圖 */}
              <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                <input type="checkbox" checked={overlayOsm} onChange={e => setOverlayOsm(e.target.checked)}
                  className="accent-emerald-500" />
                疊 OSM 山徑（半透明）——HM20C 冇嘅非正式山徑都會現身
              </label>

              {/* 預覽／警告 */}
              <div className="space-y-1 rounded-lg border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                {previewLines.map((l, i) => (
                  <div key={i} className={`flex items-start gap-1.5 ${l.warn ? 'text-amber-300' : 'text-slate-300'}`}>
                    {l.warn && <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>

              {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-300">{err}</div>}
            </div>

            {/* 底部按鈕 */}
            <div className="flex items-center justify-between border-t border-slate-700/70 px-4 py-3">
              <div className="text-[11px] text-slate-500">
                {busy ? (
                  <span className="flex items-center gap-1.5 text-emerald-300">
                    <Loader2 size={12} className="animate-spin" /> {progress || '處理中…'}
                  </span>
                ) : (
                  '圖面自動帶比例尺／指北針／CP 編號／版權標示'
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} disabled={busy}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40">
                  取消
                </button>
                <button onClick={handleExport} disabled={busy || !canExport}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-3.5 py-1.5 font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                  <Download size={14} />
                  {scope === 'pages' ? `下載 ${pageCount} 頁` : '下載 PNG'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScopeBtn({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button onClick={onClick}
      className={`rounded-lg border px-2.5 py-2 text-left transition ${active
        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
        : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'}`}>
      <div className="text-[11px] font-semibold leading-tight">{label}</div>
      <div className={`text-[9px] leading-tight ${active ? 'text-emerald-300/80' : 'text-slate-500'}`}>{sub}</div>
    </button>
  );
}
