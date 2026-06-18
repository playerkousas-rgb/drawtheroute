import React, { useState, useCallback, useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hoverSync } from '../../utils/hoverSync';
import { wgs84ToHk80, formatToHk80Shorthand } from '../../utils/coordUtils';
import {
  LatLng, RouteSegment, WaypointMarker,
  MapLayer, ElevationProfilePoint,
} from '../../types';

interface MapCoreProps {
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  mapLayer: MapLayer;
  onRouteClick: (latlng: LatLng) => void;
  isProcessing: boolean;
  searchLocation: LatLng | null;
  onSearchCleared: () => void;
  // 🚀 For bidirectional sync
  externalDistance?: number;
  onCursorMove: (distance: number, point: LatLng) => void;
}

const TILES: Record<MapLayer, { url: string; attr: string; maxZoom: number }> = {
  osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                                                          attr: '&copy; OpenStreetMap',  maxZoom: 19 },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                                                            attr: '&copy; OpenTopoMap',    maxZoom: 17 },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',               attr: '&copy; Esri',           maxZoom: 18 },
};

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function makeWpIcon(wp: WaypointMarker, idx: number): L.DivIcon {
  const isStart   = wp.type === 'start';
  const isEnd     = wp.type === 'end';
  const dotColor  = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#f59e0b';
  const labelText = isStart ? '起點' : isEnd ? '終點' : `CP ${idx}`;
  const html = `
    <div style="display:flex; align-items:center; gap:5px; background:rgba(8,14,28,0.92); border:1.5px solid rgba(148,163,184,0.18); border-radius:20px; padding:3px 8px 3px 4px; box-shadow:0 2px 10px rgba(0,0,0,0.5); white-space:nowrap; pointer-events:none; font-family:'Noto Sans TC',sans-serif;">
      <div style="width:9px; height:9px; border-radius:50%; background:${dotColor}; border:2px solid #fff; box-shadow:0 0 6px ${dotColor}; flex-shrink:0;"></div>
      <span style="color:#e2e8f0; font-size:11px; font-weight:600; line-height:1;">${labelText}</span>
      <span style="color:#6b7280; font-size:9px; font-family:monospace;">${wp.elevation.toFixed(0)}m</span>
    </div>
  `;
  return L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [7, 12] });
}

export default React.memo(function MapCore({
  segments, waypoints, mapLayer,
  onRouteClick, isProcessing,
  searchLocation, onSearchCleared,
  externalDistance, onCursorMove,
}: MapCoreProps) {
  const divRef    = useRef<HTMLDivElement>(null);
  const coordRef   = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<L.Map | null>(null);
  const tileRef   = useRef<L.TileLayer | null>(null);
  const routeGrp  = useRef<L.LayerGroup | null>(null);
  const wpGrp     = useRef<L.LayerGroup | null>(null);
  const progressGrp    = useRef<L.LayerGroup | null>(null);
  const cursorMarkerRef = useRef<L.Marker | null>(null);

  const onRouteClickRef    = useRef(onRouteClick);
  useEffect(() => { onRouteClickRef.current = onRouteClick; },    [onRouteClick]);

  // --- 🚀 核心優化：極速路徑投影算法 ---
  const projectToRoute = (latlng: L.LatLng) => {
    if (!segments.length) return null;
    let minDistance = Infinity;
    let closestPt: {lat: number, lng: number, distFromStart: number} | null = null;
    let accumulatedDist = 0;

    for (const seg of segments) {
      let segAccumulatedDist = 0;
      for (let i = 0; i < seg.points.length - 1; i++) {
        const p1 = seg.points[i];
        const p2 = seg.points[i+1];
        const dx = p2.lng - p1.lng;
        const dy = p2.lat - p1.lat;
        const lenSq = dx*dx + dy*dy;
        
        let t = 0;
        if (lenSq > 0) {
          t = Math.max(0, Math.min(1, ((latlng.lng - p1.lng) * dx + (latlng.lat - p1.lat) * dy) / lenSq));
        }
        
        const closest = { lat: p1.lat + t * dy, lng: p1.lng + t * dx };
        const d = Math.sqrt(Math.pow(latlng.lat - closest.lat, 2) + Math.pow(latlng.lng - closest.lng, 2));
        
        if (d < minDistance) {
          minDistance = d;
          const segLen = Math.sqrt(lenSq);
          closestPt = { ...closest, distFromStart: accumulatedDist + segAccumulatedDist + t * segLen };
        }
        segAccumulatedDist += Math.sqrt(lenSq);
      }
      accumulatedDist += seg.distance; 
    }
    return closestPt;
  };

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { center: [22.3964, 114.1095], zoom: 12, zoomControl: false, preferCanvas: true });
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const cfg = TILES.topo;
    tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.maxZoom }).addTo(map);
    routeGrp.current = L.layerGroup().addTo(map);
    wpGrp.current    = L.layerGroup().addTo(map);
    progressGrp.current = L.layerGroup().addTo(map);

    const cursorIcon = L.divIcon({
      className: '',
      html: `<div style="width:12px; height:12px; background:#fff; border:2px solid #3b82f6; border-radius:50%; box-shadow:0 0 8px rgba(59,130,246,0.8); z-index:10000"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6]
    });

    cursorMarkerRef.current = L.marker([22.3964, 114.1095], {
      icon: cursorIcon,
      draggable: true,
      zIndexOffset: 10000
    }).addTo(map);

    // 🚀 監聽事件總線：直接操作 DOM，實現 0 延遲吸附
    const unsubscribe = hoverSync.subscribe((point, source) => {
      if (point && cursorMarkerRef.current) {
        // 不論來源是 'chart' 還是 'map'，只要有路徑點，游標就立即吸附過去
        cursorMarkerRef.current.setLatLng([point.lat, point.lng]);
      }
    });

    cursorMarkerRef.current.on('drag', (e) => {
      const pos = e.target.getLatLng();
      const closest = projectToRoute(pos);
      if (closest) {
        e.target.setLatLng([closest.lat, closest.lng]);
        onCursorMove(closest.distFromStart, { lat: closest.lat, lng: closest.lng });
        // 同步回圖表
        hoverSync.emit({ 
          lat: closest.lat, 
          lng: closest.lng, 
          distance: closest.distFromStart, 
          elevation: 0 
        }, 'map');
      }
    });

    map.on('mousemove', (e) => {
      // 1. 更新坐標儀表板 (直接 DOM)
      if (!coordRef.current) return;
      const { lat, lng } = e.latlng;
      const hk80 = wgs84ToHk80(lat, lng);
      const shorthand = formatToHk80Shorthand(hk80.easting, hk80.northing);
      coordRef.current.innerHTML = `
        <div style="color:#94a3b8; font-size:9px; margin-bottom:2px">WGS84: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div style="color:#fff; font-size:11px; font-weight:bold; font-family:monospace">${shorthand}</div>
      `;

      // 2. 🚀 同步到剖面圖：將鼠標位置投影到路徑並發送
      const closest = projectToRoute(e.latlng);
      if (closest) {
        hoverSync.emit({
          lat: closest.lat,
          lng: closest.lng,
          distance: closest.distFromStart,
          elevation: 0 
        }, 'map');
      }
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      onRouteClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => { 
      unsubscribe();
      map.remove(); 
      mapRef.current = null; 
    };
  }, []);

  // 保持對 externalDistance 的響應（用於點擊圖表跳轉）
  useEffect(() => {
    if (!cursorMarkerRef.current || externalDistance === undefined) return;
    let currentDist = 0;
    let found = false;
    for (const seg of segments) {
      if (currentDist + seg.distance >= externalDistance) {
        const ratio = (externalDistance - currentDist) / seg.distance;
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
    waypoints.forEach((wp, idx) => {
      L.marker([wp.latlng.lat, wp.latlng.lng], { icon: makeWpIcon(wp, idx), zIndexOffset: 500, interactive: false }).addTo(grp);
    });
  }, [waypoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchLocation) return;
    map.flyTo([searchLocation.lat, searchLocation.lng], 15, { animate: true, duration: 1.5 });
    const marker = L.marker([searchLocation.lat, searchLocation.lng], {
      icon: L.divIcon({ className: '', html: `<div style="width:12px;height:12px;background:white;border:2px solid #ef4444;border-radius:50%;box-shadow:0 0 10px #ef4444"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
      interactive: false,
    }).addTo(map);
    setTimeout(() => { map.removeLayer(marker); onSearchCleared(); }, 3000);
  }, [searchLocation, onSearchCleared]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !segments.length) return;
    const pts = segments.flatMap(s => s.points.map(p => [p.lat, p.lng] as [number, number]));
    if (pts.length > 1) { try { map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15, animate: true }); } catch { } }
  }, [segments]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}>
      <div ref={divRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div
        ref={coordRef}
        style={{
          position: 'absolute', top: 20, left: 20, padding: '8px 14px',
          background: 'rgba(8, 14, 28, 0.85)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(148, 163, 184, 0.3)', borderRadius: '10px',
          zIndex: 10000, pointerEvents: 'none', fontFamily: 'monospace',
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)', textAlign: 'left', borderLeft: '4px solid #34d399'
        }}
      />
    </div>
  );
}
)
