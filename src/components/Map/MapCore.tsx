import React, { useEffect, useRef } from 'react';
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

// ── Waypoint marker HTML ──────────────────────────────────────────────────
// Each marker is a small pill: coloured dot + label + trash button
function makeWpIcon(wp: WaypointMarker, idx: number): L.DivIcon {
  const isStart   = wp.type === 'start';
  const isEnd     = wp.type === 'end';
  const dotColor  = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#f59e0b';
  const labelText = isStart ? '起點' : isEnd ? '終點' : `CP ${idx}`;

  const html = `
    <div style="
      display:flex; align-items:center; gap:5px;
      background:rgba(8,14,28,0.92);
      border:1.5px solid rgba(148,163,184,0.18);
      border-radius:20px;
      padding:3px 8px 3px 4px;
      box-shadow:0 2px 10px rgba(0,0,0,0.5);
      white-space:nowrap;
      pointer-events:none;
      font-family:'Noto Sans TC',sans-serif;
    ">
      <div style="
        width:9px; height:9px; border-radius:50%;
        background:${dotColor}; border:2px solid #fff;
        box-shadow:0 0 6px ${dotColor}; flex-shrink:0;
      "></div>
      <span style="color:#e2e8f0; font-size:11px; font-weight:600; line-height:1;">${labelText}</span>
      <span style="color:#6b7280; font-size:9px; font-family:monospace;">${wp.elevation.toFixed(0)}m</span>
    </div>
  `;

  return L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [7, 12] });
}

// ── User Position marker HTML (Neon Pulse) ──────────────────────────
function makeHoverIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        position: relative;
        width: 16px; height: 16px;
        background: #bc13fe;
        border: 2px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 15px #bc13fe, 0 0 5px #fff;
        animation: marker-pulse 1.5s infinite;
        z-index: 9999;
      "></div>
      <style>
        @keyframes marker-pulse {
          0% { box-shadow: 0 0 0 0 rgba(188, 19, 254, 0.7); transform: scale(1); }
          70% { box-shadow: 0 0 0 15px rgba(188, 19, 254, 0); transform: scale(1.2); }
          100% { box-shadow: 0 0 0 0 rgba(188, 19, 254, 0); transform: scale(1); }
        }
      </style>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

export default React.memo(function MapCore({
  segments, waypoints, mapLayer,
  onRouteClick, isProcessing,
  searchLocation, onSearchCleared,
}: MapCoreProps) {
  const divRef    = useRef<HTMLDivElement>(null);
  const dotRef    = useRef<HTMLDivElement>(null);
  const coordRef   = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<L.Map | null>(null);

  const tileRef   = useRef<L.TileLayer | null>(null);
  const routeGrp  = useRef<L.LayerGroup | null>(null);
  const wpGrp     = useRef<L.LayerGroup | null>(null);
  const hoverRef  = useRef<L.CircleMarker | null>(null);
  const progressGrp    = useRef<L.LayerGroup | null>(null);

  // Keep latest callbacks in refs to avoid stale closures
  const onRouteClickRef    = useRef(onRouteClick);
  useEffect(() => { onRouteClickRef.current = onRouteClick; },    [onRouteClick]);


  // ── Init map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;

    const map = L.map(divRef.current, {
      center: [22.3964, 114.1095],
      zoom: 12,
      zoomControl: false,
      preferCanvas: true,
    });
    mapRef.current = map;

    // 🟢 Create a dedicated pane for the hover marker to ensure it's ALWAYS on top
    map.createPane('hoverPane');
    const hp = map.getPane('hoverPane');
    if (hp) {
      hp.style.zIndex = '1000';
      hp.style.pointerEvents = 'none';
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const cfg = TILES.topo;
    tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.maxZoom }).addTo(map);

    routeGrp.current = L.layerGroup().addTo(map);
    wpGrp.current    = L.layerGroup().addTo(map);
    progressGrp.current = L.layerGroup().addTo(map);

    // 🟢 Subscription to HoverSync for the DOM Overlay dot
    const unsubscribeHover = hoverSync.subscribe((point) => {
      if (!dotRef.current) return;
      if (point) {
        const pointPx = map.latLngToContainerPoint([point.lat, point.lng]);
        dotRef.current.style.transform = `translate(${pointPx.x}px, ${pointPx.y}px)`;
        dotRef.current.style.opacity = '1';
      } else {
        dotRef.current.style.opacity = '0';
      }
    });

    // 🟢 Cursor Coordinate Tracking
    map.on('mousemove', (e) => {
      if (!coordRef.current) return;
      const { lat, lng } = e.latlng;
      const hk80 = wgs84ToHk80(lat, lng);
      const shorthand = formatToHk80Shorthand(hk80.easting, hk80.northing);
      coordRef.current.innerHTML = `
        <div style="color:#94a3b8; font-size:9px; margin-bottom:2px">WGS84: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div style="color:#fff; font-size:11px; font-weight:bold; font-family:monospace">${shorthand}</div>
      `;
    });

    // Ensure progress group is always on top


    map.addLayer(progressGrp.current);

    // Map click → add waypoint

    map.on('click', (e: L.LeafletMouseEvent) => {
      onRouteClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => { 
      unsubscribeHover(); 
      map.remove(); 
      mapRef.current = null; 
    };
  }, []); // eslint-disable-line

  // ── Tile layer swap ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const cfg = TILES[mapLayer];
    tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.maxZoom }).addTo(map);
    tileRef.current.bringToBack();
  }, [mapLayer]);

  // ── Cursor ────────────────────────────────────────────────────────
  useEffect(() => {
    mapRef.current?.getContainer().style.setProperty(
      'cursor', isProcessing ? 'wait' : 'crosshair'
    );
  }, [isProcessing]);

  // ── Draw route segments ───────────────────────────────────────────
  useEffect(() => {
    const grp = routeGrp.current;
    if (!grp) return;
    grp.clearLayers();

    segments.forEach((seg, idx) => {
      if (seg.points.length < 2) return;
      const ll: L.LatLngExpression[] = seg.points.map(p => [p.lat, p.lng]);

      // Glow layer
      L.polyline(ll, {
        color: seg.mode === 'auto' ? '#065f46' : '#78350f',
        weight: 9, opacity: 0.35, smoothFactor: 1.5,
      }).addTo(grp);

      // Main line
      L.polyline(ll, {
        color:       seg.mode === 'auto' ? '#34d399' : '#fbbf24',
        weight:      3.5,
        opacity:     1,
        smoothFactor: 1.5,
        dashArray:   seg.mode === 'straight' ? '10 6' : undefined,
      }).addTo(grp);

      // Mid-point distance badge
      const mid = seg.points[Math.floor(seg.points.length / 2)];
      L.marker([mid.lat, mid.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            background:rgba(8,14,28,0.88);
            color:#94a3b8;
            font-size:10px;
            padding:2px 6px;
            border-radius:4px;
            border:1px solid rgba(148,163,184,0.2);
            white-space:nowrap;
            font-family:monospace;
          ">§${idx + 1} · ${seg.distance.toFixed(2)} km · ↑${seg.ascent.toFixed(0)}m</div>`,
          iconAnchor: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 100,
      }).addTo(grp);
    });
  }, [segments]);

  // ── Draw waypoints with delete buttons ───────────────────────────
  useEffect(() => {
    const grp = wpGrp.current;
    if (!grp) return;
    grp.clearLayers();

    waypoints.forEach((wp, idx) => {
      L.marker([wp.latlng.lat, wp.latlng.lng], {
        icon: makeWpIcon(wp, idx),
        zIndexOffset: 500,
        interactive: false,
      }).addTo(grp);
    });
  }, [waypoints]);

  // ── Handle search location ──────────────────────────────────────





  // ── Handle search location ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchLocation) return;
    
    map.flyTo([searchLocation.lat, searchLocation.lng], 15, {
      animate: true,
      duration: 1.5
    });
    
    // Add a temporary marker
    const marker = L.marker([searchLocation.lat, searchLocation.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;background:white;border:2px solid #ef4444;border-radius:50%;box-shadow:0 0 10px #ef4444"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
      interactive: false,
    }).addTo(map);
    
    setTimeout(() => {
      map.removeLayer(marker);
      onSearchCleared();
    }, 3000);
  }, [searchLocation, onSearchCleared]);

  // ── Auto-fit bounds ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !segments.length) return;
    const pts = segments.flatMap(s => s.points.map(p => [p.lat, p.lng] as [number, number]));
    if (pts.length > 1) {
      try {
        map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15, animate: true });
      } catch { /* ignore */ }
    }
  }, [segments]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}>
      <div
        ref={divRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {/* 🚀 High-performance Hover Dot Overlay */}
      <div
        ref={dotRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 20,
          height: 20,
          backgroundColor: '#00ffff',
          border: '3px solid white',
          borderRadius: '50%',
          boxShadow: '0 0 20px #00ffff, 0 0 8px white',
          zIndex: 10000,
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.1s ease',
          marginLeft: -10,
          marginTop: -10,
        }}
      />
      {/* 📍 Real-time Coordinate Display */}
      <div
        ref={coordRef}
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          padding: '6px 12px',
          background: 'rgba(8, 14, 28, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          borderRadius: '8px',
          zIndex: 10000,
          pointerEvents: 'none',
          fontFamily: 'monospace',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          textAlign: 'right'
        }}
      />
    </div>
  );
}
)
