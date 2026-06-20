import React, { useState, useCallback, useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import proj4 from 'proj4';
import { hoverSync } from '../../utils/hoverSync';
import { convertWgs84ToHk80, formatToHk80Shorthand, wgs84ToHikingShorthand4 } from '../../utils/coordUtils';
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
  profile: ElevationProfilePoint[]; 
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
  profile, externalDistance, onCursorMove,
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
      const pos = e.target.getLatLng();
      let closest = profile[0];
      let minD = Infinity;
      for (const p of profile) {
        const d = Math.pow(p.lat - pos.lat, 2) + Math.pow(p.lng - pos.lng, 2);
        if (d < minD) { minD = d; closest = p; }
      }
      e.target.setLatLng([closest.lat, closest.lng]);
      onCursorMove(closest.distance, { lat: closest.lat, lng: closest.lng });
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

      if (profile.length > 0) {
        let closest = profile[0];
        let minD = Infinity;
        for (const p of profile) {
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
      onRouteClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => { 
      unsubscribe();
      map.remove(); 
      mapRef.current = null; 
    };
  }, [profile]);

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
      icon: L.divIcon({ className: '', html: `<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 10px #3b82f6;"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
      interactive: false,
    }).addTo(map);
    setTimeout(() => { map.removeLayer(marker); onSearchCleared(); }, 3000);
  }, [searchLocation, onSearchCleared]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !segments.length) return;
    const pts = segments.flatMap(s => s.points);
    if (pts.length > 0) {
      const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [segments]);

  return (
    <div className="relative w-full h-full">
      <div ref={divRef} className="w-full h-full" />
      
      {/* 左上角座標顯示 */}
      <div 
        ref={coordRef}
        className="absolute top-3 left-3 bg-black/70 text-white px-3 py-1.5 rounded text-xs font-mono z-[1000] pointer-events-none border border-white/10"
      />
    </div>
  );
});
