import React, { useRef, useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hoverSync } from '../../utils/hoverSync';
import { screenScaleDenominator } from '../../lib/mapImageExport';
import { wgs84ToHikingShorthand4 } from '../../utils/coordUtils';
import { legMidpoints, haversineM } from '../../utils/routeGeometry';
import {
  LatLng, RouteSegment, WaypointMarker,
  MapLayer, ElevationProfilePoint,
} from '../../types';

export type MapMode = 'idle' | 'draw' | 'edit';

interface MapCoreProps {
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  mapLayer: MapLayer;
  onRouteClick: (latlng: LatLng) => void;
  isProcessing: boolean;
  searchLocation: LatLng | null;
  onSearchCleared: () => void;
  profile: ElevationProfilePoint[]; 
  externalDistance?: number;
  onCursorMove: (distance: number, point: LatLng) => void;
  /** 互動模式：idle = 點擊加路點；draw = 手繪；edit = 拖曳微調 */
  mode: MapMode;
  /** 手繪完成（放手後）回傳原始軌跡，由 App 決定貼路與否 */
  onDrawStroke: (points: LatLng[]) => void | Promise<void>;
  onMoveWaypoint: (index: number, latlng: LatLng) => void;
  onInsertVia: (segIndex: number, viaIndex: number, latlng: LatLng) => void;
  onMoveVia: (segIndex: number, viaIndex: number, latlng: LatLng) => void;
  onDeleteVia: (segIndex: number, viaIndex: number) => void;
  onDeleteWaypoint: (index: number) => void;
  onEditClick: (latlng: LatLng, toleranceM: number) => void;
  /** 右側面板／橫切面高亮中的路點索引 */
  highlightWaypoint?: number | null;
  /** 拖曳路點開始／結束（供橫切面即時反饋） */
  onWaypointDragState?: (index: number | null) => void;
  /** 地圖建立完成（供 App 取得 Leaflet 實例做圖片匯出） */
  onMapReady?: (map: L.Map) => void;
}

const TILES: Record<MapLayer, { url: string; attr: string; maxZoom: number }> = {
  osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                                          attr: '&copy; OpenStreetMap',  maxZoom: 19 },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                                                            attr: '&copy; OpenTopoMap',    maxZoom: 17 },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',               attr: '&copy; Esri',           maxZoom: 18 },
  /** 地政總署 1:20,000 地形圖（HM20C 同源 iB20000 資料）— Map from Lands Department（LandsD Map API TNC） */
  hm20c:     { url: 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png',                                attr: 'Map from Lands Department', maxZoom: 20 },
};

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/** 每個 leg 最多顯示幾個「新增彎位」手柄（只挑最長的 leg） */
const MAX_HANDLES_PER_SEGMENT = 8;
/** 少於這個長度（米）的 leg 不出手柄，避免疊在一起 */
const MIN_HANDLE_LEG_M = 120;
/** 點擊路線加入彎位的判定距離（像素） */
const EDIT_CLICK_TOLERANCE_PX = 26;

function wpColor(wp: WaypointMarker): string {
  return wp.type === 'start' ? '#22c55e' : wp.type === 'end' ? '#ef4444' : '#f59e0b';
}

function wpLabel(wp: WaypointMarker, idx: number): string {
  return wp.type === 'start' ? '起點' : wp.type === 'end' ? '終點' : `CP ${idx}`;
}

function makeWpIcon(wp: WaypointMarker, idx: number): L.DivIcon {
  const dotColor = wpColor(wp);
  const labelText = wpLabel(wp, idx);
  const html = `
    <div style="display:flex; align-items:center; gap:5px; background:rgba(8,14,28,0.92); border:1.5px solid rgba(148,163,184,0.18); border-radius:20px; padding:3px 8px 3px 4px; box-shadow:0 2px 10px rgba(0,0,0,0.5); white-space:nowrap; pointer-events:none; font-family:'Noto Sans TC',sans-serif;">
      <div style="width:9px; height:9px; border-radius:50%; background:${dotColor}; border:2px solid #fff; box-shadow:0 0 6px ${dotColor}; flex-shrink:0;"></div>
      <span style="color:#e2e8f0; font-size:11px; font-weight:600; line-height:1;">${labelText}</span>
      <span style="color:#6b7280; font-size:9px; font-family:monospace;">${wp.elevation.toFixed(0)}m</span>
    </div>
  `;
  return L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [7, 12] });
}

/** 手柄統一用「零尺寸樞軸 + 置中膠囊」，令拖曳點與視覺中心一致 */
function pivot(inner: string): string {
  return `<div style="position:relative;width:0;height:0;">
    <div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;gap:5px;background:rgba(8,14,28,0.96);border-radius:20px;padding:3px 6px 3px 4px;box-shadow:0 2px 12px rgba(0,0,0,0.65);white-space:nowrap;font-family:'Noto Sans TC',sans-serif;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;">
      ${inner}
    </div>
  </div>`;
}

const DEL_BTN = `<button data-del="1" title="刪除" style="width:16px;height:16px;flex-shrink:0;border-radius:50%;border:1px solid rgba(248,113,113,0.55);background:rgba(127,29,29,0.55);color:#fecaca;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;">✕</button>`;

function makeWaypointGripIcon(wp: WaypointMarker, idx: number, highlighted = false): L.DivIcon {
  const color = wpColor(wp);
  const inner = `
    <div style="width:11px;height:11px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color};flex-shrink:0;"></div>
    <span style="color:#e2e8f0;font-size:11px;font-weight:700;line-height:1;">${wpLabel(wp, idx)}</span>
    <span style="color:#94a3b8;font-size:9px;font-family:monospace;">${wp.elevation.toFixed(0)}m</span>
    ${DEL_BTN}`;
  const ring = highlighted ? `border-width:2.5px;box-shadow:0 0 0 4px ${color}33, 0 2px 16px rgba(0,0,0,0.7);` : '';
  const html = `<div style="position:relative;width:0;height:0;"><div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;gap:5px;background:rgba(8,14,28,0.96);border:1.5px solid ${color};border-radius:20px;padding:3px 6px 3px 4px;box-shadow:0 2px 12px rgba(0,0,0,0.65);white-space:nowrap;font-family:'Noto Sans TC',sans-serif;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;${ring}">${inner}</div></div>`;
  return L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] });
}

function makeViaGripIcon(): L.DivIcon {
  const c = '#f59e0b';
  const inner = `
    <div style="width:13px;height:13px;border-radius:50%;background:rgba(245,158,11,0.18);border:2px solid ${c};box-shadow:0 0 9px rgba(245,158,11,0.7);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
      <div style="width:4px;height:4px;border-radius:50%;background:${c};"></div>
    </div>
    <span style="color:#fcd34d;font-size:10px;font-weight:700;line-height:1;">彎位</span>
    ${DEL_BTN}`;
  return L.divIcon({ className: '', html: pivot(inner), iconSize: [0, 0], iconAnchor: [0, 0] });
}

function makeInsertHandleIcon(): L.DivIcon {
  const inner = `
    <div style="width:17px;height:17px;border-radius:50%;border:1.5px dashed #93c5fd;background:rgba(30,58,138,0.55);color:#dbeafe;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;font-weight:700;">+</div>
    <span style="color:#bfdbfe;font-size:9px;font-weight:600;line-height:1;">加彎位</span>`;
  return L.divIcon({ className: '', html: pivot(inner), iconSize: [0, 0], iconAnchor: [0, 0] });
}

export default React.memo(function MapCore({
  segments, waypoints, mapLayer,
  onRouteClick, isProcessing,
  searchLocation, onSearchCleared,
  profile, externalDistance, onCursorMove,
  mode,
  onDrawStroke, onMoveWaypoint, onInsertVia, onMoveVia, onDeleteVia, onDeleteWaypoint,
  onEditClick,
  highlightWaypoint = null, onWaypointDragState,
  onMapReady,
}: MapCoreProps) {
  const divRef    = useRef<HTMLDivElement>(null);
  const coordRef   = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<L.Map | null>(null);
  const tileRef   = useRef<L.TileLayer | null>(null);
  const routeGrp  = useRef<L.LayerGroup | null>(null);
  const wpGrp     = useRef<L.LayerGroup | null>(null);
  const progressGrp    = useRef<L.LayerGroup | null>(null);
  const drawGrp   = useRef<L.LayerGroup | null>(null);
  const editGrp   = useRef<L.LayerGroup | null>(null);
  const guideGrp  = useRef<L.LayerGroup | null>(null);
  const cursorMarkerRef = useRef<L.Marker | null>(null);

  const onRouteClickRef    = useRef(onRouteClick);
  useEffect(() => { onRouteClickRef.current = onRouteClick; },    [onRouteClick]);

  // Keep latest values in refs so the once-created map's handlers never go stale
  // and the map is NOT torn down & recreated on every profile change.
  const onCursorMoveRef  = useRef(onCursorMove);
  const profileRef       = useRef(profile);
  const modeRef          = useRef<MapMode>(mode);
  const onDrawStrokeRef  = useRef(onDrawStroke);
  const onEditClickRef   = useRef(onEditClick);
  const onMoveWaypointRef = useRef(onMoveWaypoint);
  const onInsertViaRef   = useRef(onInsertVia);
  const onMoveViaRef     = useRef(onMoveVia);
  const onDeleteViaRef   = useRef(onDeleteVia);
  const onDeleteWaypointRef = useRef(onDeleteWaypoint);
  const isProcessingRef = useRef(isProcessing);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);
  const onWaypointDragStateRef = useRef(onWaypointDragState);
  useEffect(() => { onWaypointDragStateRef.current = onWaypointDragState; }, [onWaypointDragState]);
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => { onMapReadyRef.current = onMapReady; }, [onMapReady]);
  /** 螢幕即時比例（約 1:N）徽章——「自動 fit 並告知比例」嘅地圖側呈現 */
  const [scaleDenom, setScaleDenom] = useState<number | null>(null);
  /** 微調模式的路點手柄（索引 → marker），供高亮即時切換，唔需要重建圖層 */
  const wpGripsRef = useRef<Map<number, L.Marker>>(new Map());
  useEffect(() => { onCursorMoveRef.current = onCursorMove; }, [onCursorMove]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onDrawStrokeRef.current = onDrawStroke; }, [onDrawStroke]);
  useEffect(() => { onEditClickRef.current = onEditClick; }, [onEditClick]);
  useEffect(() => { onMoveWaypointRef.current = onMoveWaypoint; }, [onMoveWaypoint]);
  useEffect(() => { onInsertViaRef.current = onInsertVia; }, [onInsertVia]);
  useEffect(() => { onMoveViaRef.current = onMoveVia; }, [onMoveVia]);
  useEffect(() => { onDeleteViaRef.current = onDeleteVia; }, [onDeleteVia]);
  useEffect(() => { onDeleteWaypointRef.current = onDeleteWaypoint; }, [onDeleteWaypoint]);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { center: [22.3964, 114.1095], zoom: 12, zoomControl: false, preferCanvas: true });
    mapRef.current = map;
    onMapReadyRef.current?.(map);
    // 即時比例徽章（約 1:N @96dpi）
    const updateScaleBadge = () => setScaleDenom(screenScaleDenominator(map));
    map.on('zoomend moveend', updateScaleBadge);
    updateScaleBadge();
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const cfg = TILES.topo;
    tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.maxZoom }).addTo(map);
    routeGrp.current = L.layerGroup().addTo(map);
    wpGrp.current    = L.layerGroup().addTo(map);
    progressGrp.current = L.layerGroup().addTo(map);
    drawGrp.current  = L.layerGroup().addTo(map);
    guideGrp.current = L.layerGroup().addTo(map);
    editGrp.current  = L.layerGroup().addTo(map);

    const cursorIcon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative; width:30px; height:30px; display:flex; align-items:center; justify-content:center;">
          <div style="position:absolute; width:12px; height:12px; background:#fff; border:3px solid #3b82f6; border-radius:50%; z-index:10; box-shadow:0 0 15px rgba(0,0,0,0.8), 0 0 5px #3b82f6;"></div>
          <div style="position:absolute; width:100%; height:100%; border:3px solid #3b82f6; border-radius:50%; animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; opacity: 0;"></div>
          <style>
            @keyframes pulse-ring {
              0% { transform: scale(0.33); opacity: 0.8; }
              80%, 100% { transform: scale(1.8); opacity: 0; }
            }
          </style>
        </div>
      `,
      iconSize: [30, 30], iconAnchor: [15, 15]
    });

    cursorMarkerRef.current = L.marker([22.3964, 114.1095], {
      icon: cursorIcon,
      draggable: true,
      zIndexOffset: 10000
    }).addTo(map);

    const unsubscribe = hoverSync.subscribe((payload, source) => {
      if (payload && cursorMarkerRef.current) {
        cursorMarkerRef.current.setLatLng([payload.lat, payload.lng]);
      }
    });

    cursorMarkerRef.current.on('drag', (e) => {
      if (modeRef.current !== 'idle') return;
      const pos = e.target.getLatLng();
      const prof = profileRef.current;
      if (!prof.length) return;
      let closest = prof[0];
      let minD = Infinity;
      for (const p of prof) {
        const d = Math.pow(p.lat - pos.lat, 2) + Math.pow(p.lng - pos.lng, 2);
        if (d < minD) { minD = d; closest = p; }
      }
      e.target.setLatLng([closest.lat, closest.lng]);
      onCursorMoveRef.current(closest.distance, { lat: closest.lat, lng: closest.lng });
      hoverSync.emit(closest, 'map');
    });

    map.on('mousemove', async (e) => {
      if (!coordRef.current) return;
      const { lat, lng } = e.latlng;
      
      try {
        // ✅ 已修改：使用 4 位數即時函式
        const shorthand = wgs84ToHikingShorthand4(lat, lng);
        
        coordRef.current.innerHTML = `
          <div style="color:#94a3b8; font-size:9px; margin-bottom:2px">WGS84: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          <div style="color:#fff; font-size:11px; font-weight:bold; font-family:monospace">${shorthand}</div>
        `;
      } catch (err) {
        coordRef.current.innerHTML = `<div style="color:#ef4444; font-size:11px">坐標轉換錯誤</div>`;
      }

      // 手繪／微調模式下不干擾高程游標
      if (modeRef.current !== 'idle') return;

      const prof = profileRef.current;
      if (prof.length > 0) {
        let closest = prof[0];
        let minD = Infinity;
        for (const p of prof) {
          const d = Math.pow(p.lat - lat, 2) + Math.pow(p.lng - lng, 2);
          if (d < minD) { minD = d; closest = p; }
        }
        hoverSync.emit(closest, 'map');
        if (cursorMarkerRef.current) {
          cursorMarkerRef.current.setLatLng([closest.lat, closest.lng]);
        }
      }
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      const m = modeRef.current;
      if (m === 'draw') return;                 // 手繪模式：由 pointer 事件處理
      if (m === 'edit') {
        const lat = e.latlng.lat;
        const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
        onEditClickRef.current({ lat, lng: e.latlng.lng }, mpp * EDIT_CLICK_TOLERANCE_PX);
        return;
      }
      onRouteClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => { 
      unsubscribe();
      map.remove(); 
      mapRef.current = null; 
    };
  }, []);

  // ── 模式切換：游標標記不再搶 pointer（手繪／微調時） ───────────────────
  useEffect(() => {
    const mk = cursorMarkerRef.current;
    if (!mk) return;
    const locked = mode !== 'idle';
    const el = mk.getElement();
    if (locked) {
      mk.dragging?.disable();
      if (el) (el as HTMLElement).style.pointerEvents = 'none';
    } else {
      mk.dragging?.enable();
      if (el) (el as HTMLElement).style.pointerEvents = '';
    }
  }, [mode]);

  // ── 手繪模式：pointer 事件畫線 + 放手後交給 App 貼路 ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const grp = drawGrp.current;
    if (!map || !grp) return;

    const container = map.getContainer();
    const clearStroke = () => grp.clearLayers();

    if (mode !== 'draw') {
      map.dragging.enable();
      // 微調模式：仍可平移地圖，但觸控要完全交給 Leaflet（拖手柄唔會被瀏覽器手勢搶走）
      container.style.touchAction = mode === 'edit' ? 'none' : '';
      clearStroke();
      return;
    }

    map.dragging.disable();
    container.style.touchAction = 'none';

    let active = false;
    let busy = false;
    let pts: LatLng[] = [];
    let line: L.Polyline | null = null;

    const redraw = () => line?.setLatLngs(pts.map(p => [p.lat, p.lng] as [number, number]));
    const dropLine = () => { if (line) { line.remove(); line = null; } };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.isPrimary === false) return;
      if (busy || isProcessingRef.current) return;           // 貼路運算中不開新筆畫
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.leaflet-control')) return;      // 縮放控制等唔好當成畫線
      active = true;
      pts = [];
      dropLine();
      line = L.polyline([], {
        color: '#a78bfa', weight: 4, opacity: 0.95, dashArray: '7 5',
        lineCap: 'round', lineJoin: 'round',
      }).addTo(grp);
      pts.push(map.mouseEventToLatLng(e));
      redraw();
      try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!active) return;
      const ll = map.mouseEventToLatLng(e);
      const last = pts[pts.length - 1];
      if (!last || haversineM(last, ll) >= 4) {
        pts.push(ll);
        redraw();
      }
      e.preventDefault();
    };

    const onUp = async () => {
      if (!active) return;
      active = false;
      const stroke = pts.slice();
      pts = [];
      const myLine = line;
      if (stroke.length < 2 || !myLine) { dropLine(); return; }
      busy = true;
      // 放手後保留淺色原線，等貼路結果出爐才清掉
      myLine.setStyle({ opacity: 0.35, color: '#60a5fa', dashArray: '4 5' });
      try {
        await onDrawStrokeRef.current(stroke);
      } finally {
        // 等 React 把新路段畫上地圖才清掉手繪預覽
        setTimeout(() => { myLine.remove(); if (line === myLine) line = null; }, 60);
        busy = false;
      }
    };

    // 手勢被系統取消（來電、切 app…）→ 放棄這一筆，不要當成完成
    const onCancel = () => {
      if (!active) return;
      active = false;
      pts = [];
      dropLine();
    };

    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);

    return () => {
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      map.dragging.enable();
      container.style.touchAction = '';
      clearStroke();
    };
  }, [mode]);

  useEffect(() => {
    if (!cursorMarkerRef.current || externalDistance === undefined) return;
    let currentDist = 0;
    let found = false;
    for (const seg of segments) {
      if (seg.distance === 0 || seg.points.length === 0) {
        currentDist += seg.distance;
        continue;
      }
      if (currentDist + seg.distance >= externalDistance) {
        const ratio = Math.max(0, Math.min(1, (externalDistance - currentDist) / seg.distance));
        const p1 = seg.points[0];
        const p2 = seg.points[seg.points.length - 1];
        const lat = p1.lat + ratio * (p2.lat - p1.lat);
        const lng = p1.lng + ratio * (p2.lng - p1.lng);
        cursorMarkerRef.current.setLatLng([lat, lng]);
        found = true;
        break;
      }
      currentDist += seg.distance;
    }
    if (!found && segments.length > 0) {
      const lastPt = segments[segments.length - 1].points[segments[segments.length - 1].points.length - 1];
      cursorMarkerRef.current.setLatLng([lastPt.lat, lastPt.lng]);
    }
  }, [externalDistance, segments]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const cfg = TILES[mapLayer];
    tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.maxZoom }).addTo(map);
    tileRef.current.bringToBack();
  }, [mapLayer]);

  useEffect(() => {
    mapRef.current?.getContainer().style.setProperty('cursor', isProcessing ? 'wait' : 'crosshair');
  }, [isProcessing]);

  useEffect(() => {
    const grp = routeGrp.current;
    if (!grp) return;
    grp.clearLayers();
    segments.forEach((seg, idx) => {
      if (seg.points.length < 2) return;
      const ll: L.LatLngExpression[] = seg.points.map(p => [p.lat, p.lng]);
      L.polyline(ll, { color: seg.mode === 'auto' ? '#065f46' : '#78350f', weight: 9, opacity: 0.35, smoothFactor: 1.5 }).addTo(grp);
      L.polyline(ll, { color: seg.mode === 'auto' ? '#34d399' : '#fbbf24', weight: 3.5, opacity: 1, smoothFactor: 1.5, dashArray: seg.mode === 'straight' ? '10 6' : undefined }).addTo(grp);
    });
  }, [segments]);

  useEffect(() => {
    const grp = wpGrp.current;
    if (!grp) return;
    grp.clearLayers();
    if (mode === 'edit') return;   // 微調模式改用手柄顯示（見下）
    waypoints.forEach((wp, idx) => {
      L.marker([wp.latlng.lat, wp.latlng.lng], { icon: makeWpIcon(wp, idx), zIndexOffset: 500, interactive: false }).addTo(grp);
    });
  }, [waypoints, mode]);

  // ── 微調模式：可拖曳手柄（路點 / 彎位 / 加彎位） ────────────────────────
  useEffect(() => {
    const grp = editGrp.current;
    const guide = guideGrp.current;
    if (!grp || !guide) return;
    grp.clearLayers();
    guide.clearLayers();
    if (mode !== 'edit') return;

    let guides: L.Polyline[] = [];
    const clearGuides = () => { guides.forEach(g => g.remove()); guides = []; };
    const showGuide = (pts: LatLng[]) => {
      clearGuides();
      for (let i = 0; i < pts.length - 1; i++) {
        guides.push(L.polyline(
          [[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]],
          { color: '#60a5fa', weight: 2, opacity: 0.95, dashArray: '4 4', interactive: false }
        ).addTo(guide));
      }
    };

    const wireDeleteButton = (marker: L.Marker, onDelete: () => void) => {
      const el = marker.getElement();
      const btn = el?.querySelector('[data-del="1"]') as HTMLElement | null;
      if (!btn) return;
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'mousedown touchstart', L.DomEvent.stopPropagation);
      L.DomEvent.on(btn, 'click', (ev: Event) => {
        L.DomEvent.stop(ev);
        onDelete();
      });
    };

    const attachDrag = (marker: L.Marker, guideFor: (cur: LatLng) => LatLng[], commit: (ll: LatLng) => void) => {
      const cur = () => {
        const p = marker.getLatLng();
        return { lat: p.lat, lng: p.lng };
      };
      marker.on('dragstart', () => { marker.setZIndexOffset(3000); showGuide(guideFor(cur())); });
      marker.on('drag', () => showGuide(guideFor(cur())));
      marker.on('dragend', () => {
        marker.setZIndexOffset(1500);
        clearGuides();
        commit(cur());
      });
    };

    // 1) 路點手柄（可拖曳 → 沿途滑動；顯示導引虛線；可被右側面板／橫切面高亮）
    wpGripsRef.current.clear();
    waypoints.forEach((wp, idx) => {
      const marker = L.marker([wp.latlng.lat, wp.latlng.lng], {
        icon: makeWaypointGripIcon(wp, idx),
        draggable: true,
        autoPan: true,
        keyboard: false,
        zIndexOffset: 1500,
      }).addTo(grp);
      wpGripsRef.current.set(idx, marker);

      attachDrag(
        marker,
        (cur) => {
          const pts: LatLng[] = [];
          if (idx > 0) pts.push(waypoints[idx - 1].latlng);
          pts.push(cur);
          if (idx < waypoints.length - 1) pts.push(waypoints[idx + 1].latlng);
          return pts;
        },
        (ll) => onMoveWaypointRef.current(idx, ll)
      );
      marker.on('dragstart', () => onWaypointDragStateRef.current?.(idx));
      marker.on('dragend', () => onWaypointDragStateRef.current?.(null));
      wireDeleteButton(marker, () => onDeleteWaypointRef.current(idx));
      marker.on('contextmenu', () => onDeleteWaypointRef.current(idx));
    });

    // 2) 彎位（via）手柄 + 3) 加彎位手柄
    segments.forEach((seg, si) => {
      const from = waypoints[si]?.latlng;
      const to = waypoints[si + 1]?.latlng;
      if (!from || !to || seg.points.length < 2) return;
      const vias = seg.via ?? [];
      const anchors: LatLng[] = [from, ...vias, to];

      vias.forEach((via, vi) => {
        const marker = L.marker([via.lat, via.lng], {
          icon: makeViaGripIcon(),
          draggable: true,
          autoPan: true,
          keyboard: false,
          zIndexOffset: 1600,
        }).addTo(grp);

        attachDrag(
          marker,
          (cur) => [anchors[vi], cur, anchors[vi + 2]],
          (ll) => onMoveViaRef.current(si, vi, ll)
        );
        wireDeleteButton(marker, () => onDeleteViaRef.current(si, vi));
        marker.on('contextmenu', () => onDeleteViaRef.current(si, vi));
      });

      const handles = legMidpoints(anchors, seg.points, MIN_HANDLE_LEG_M)
        .sort((a, b) => b.lengthM - a.lengthM)
        .slice(0, MAX_HANDLES_PER_SEGMENT);

      handles.forEach(h => {
        const marker = L.marker([h.point.lat, h.point.lng], {
          icon: makeInsertHandleIcon(),
          draggable: true,
          autoPan: true,
          keyboard: false,
          zIndexOffset: 1400,
        }).addTo(grp);

        attachDrag(
          marker,
          (cur) => [anchors[h.leg], cur, anchors[h.leg + 1]],
          (ll) => onInsertViaRef.current(si, h.leg, ll)
        );
      });
    });

    return () => { clearGuides(); guide.clearLayers(); };
  }, [mode, segments, waypoints]);

  // 高亮（右側面板 hover / 橫切面拖曳）→ 即時改樣式，唔會重建圖層
  useEffect(() => {
    if (mode !== 'edit') return;
    wpGripsRef.current.forEach((marker, idx) => {
      const wp = waypoints[idx];
      if (!wp) return;
      const hl = highlightWaypoint === idx;
      marker.setZIndexOffset(hl ? 3000 : 1500);
      const capsule = marker.getElement()?.firstElementChild?.firstElementChild as HTMLElement | null;
      if (!capsule) return;
      const color = wpColor(wp);
      capsule.style.boxShadow = hl
        ? `0 0 0 4px ${color}33, 0 2px 16px rgba(0,0,0,0.7)`
        : '0 2px 12px rgba(0,0,0,0.65)';
      capsule.style.borderWidth = hl ? '2.5px' : '1.5px';
    });
  }, [highlightWaypoint, mode, waypoints]);

  // 重算中：暫停手柄拖曳，避免兩個重算互相覆蓋
  useEffect(() => {
    const grp = editGrp.current;
    if (!grp) return;
    grp.eachLayer(layer => {
      const marker = layer as L.Marker;
      if (!marker.dragging) return;
      try {
        if (isProcessing) marker.dragging.disable();
        else marker.dragging.enable();
      } catch { /* ignore */ }
    });
  }, [isProcessing, mode, segments, waypoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchLocation) return;
    map.flyTo([searchLocation.lat, searchLocation.lng], 15, { animate: true, duration: 1.5 });
    const marker = L.marker([searchLocation.lat, searchLocation.lng], {
      icon: L.divIcon({ className: '', html: `<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 10px #3b82f6;"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
      interactive: false,
    }).addTo(map);
    setTimeout(() => { map.removeLayer(marker); onSearchCleared(); }, 3000);
  }, [searchLocation, onSearchCleared]);

  // 只在路線節點數變化時自動 fitBounds（避免拖曳手柄每拖一下就重新對焦）
  const fitKeyRef = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !segments.length) return;
    const key = `${waypoints.length}-${segments.length}`;
    if (key === fitKeyRef.current) return;
    fitKeyRef.current = key;
    const pts = segments.flatMap(s => s.points);
    if (pts.length > 0) {
      const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [segments, waypoints.length]);

  return (
    <div className="relative w-full h-full">
      <div ref={divRef} className="w-full h-full" />
      
      {/* 左上角座標顯示 */}
      <div 
        ref={coordRef}
        className="absolute top-3 left-3 bg-black/70 text-white px-3 py-1.5 rounded text-xs font-mono z-[1000] pointer-events-none border border-white/10"
      />

      {/* 右上角即時比例（約 1:N） */}
      {scaleDenom !== null && (
        <div className="absolute top-3 right-3 bg-black/70 text-white px-2.5 py-1 rounded text-[10px] font-mono z-[1000] pointer-events-none border border-white/10">
          約 1:{scaleDenom.toLocaleString('en-US')}
        </div>
      )}
    </div>
  );
});
