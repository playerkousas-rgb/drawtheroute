import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  LatLng, RouteSegment, WaypointMarker,
  MapLayer, ElevationProfilePoint,
} from '../../types';

interface MapCoreProps {
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  mapLayer: MapLayer;
  onRouteClick: (latlng: LatLng) => void;
  hoveredPoint: ElevationProfilePoint | null;
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

// Hover crosshair
const hoverIcon = L.divIcon({
  className: '',
  html: `<div style="width:16px;height:16px;background:#60a5fa;border:3px solid #fff;border-radius:50%;box-shadow:0 0 14px #60a5fa"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export default function MapCore({
  segments, waypoints, mapLayer,
  onRouteClick, hoveredPoint, isProcessing,
  searchLocation, onSearchCleared,
}: MapCoreProps) {
  const divRef    = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<L.Map | null>(null);
  const tileRef   = useRef<L.TileLayer | null>(null);
  const routeGrp  = useRef<L.LayerGroup | null>(null);
  const wpGrp     = useRef<L.LayerGroup | null>(null);
  const hoverRef  = useRef<L.Marker | null>(null);
  const progressLineRef = useRef<L.Polyline | null>(null);


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

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const cfg = TILES.topo;
    tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: cfg.maxZoom }).addTo(map);

    routeGrp.current = L.layerGroup().addTo(map);
    wpGrp.current    = L.layerGroup().addTo(map);

    // Map click → add waypoint
    map.on('click', (e: L.LeafletMouseEvent) => {
      onRouteClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => { map.remove(); mapRef.current = null; };
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

  // ── Elevation profile hover marker & Progress Line ──────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Handle the Marker (Blue Circle)
    if (hoverRef.current) { 
      map.removeLayer(hoverRef.current); 
      hoverRef.current = null; 
    }
    if (hoveredPoint) {
      hoverRef.current = L.marker(
        [hoveredPoint.lat, hoveredPoint.lng],
        { icon: hoverIcon, interactive: false, zIndexOffset: 2000 }
      ).addTo(map);
    }

    // 2. Handle the Progress Line (Highlighting the green line)
    if (progressLineRef.current) {
      map.removeLayer(progressLineRef.current);
      progressLineRef.current = null;
    }

    if (hoveredPoint && segments.length > 0) {
      const path: L.LatLngExpression[] = [];
      let accumulatedDist = 0;
      let found = false;

      for (const seg of segments) {
        for (const p of seg.points) {
          path.push([p.lat, p.lng]);
          
          // We estimate the distance along the points to find where the hoveredPoint fits
          // Since hoveredPoint is part of the elevation profile, we can use its distance
          // Note: This is a simplified approach; for perfect accuracy, we'd track segment distance
        }
        accumulatedDist += seg.distance;
        if (accumulatedDist >= hoveredPoint.distance * 1000) { // Convert km to m
          found = true;
          break;
        }
      }

      // To make it precise, we trim the path to the exact point of the hoveredPoint
      // We use the hoveredPoint's actual coordinates as the final point
      if (path.length > 0) {
        // Since we don't have a perfect point-by-point distance map here, 
        // we find the segment and interpolate or simply use the points up to the 
        // segment where the distance was reached, then end with the hoveredPoint.
        
        // Find the segment containing the point
        let currentDist = 0;
        let cutPath: L.LatLngExpression[] = [];
        for (const seg of segments) {
          if (currentDist + seg.distance * 1000 > hoveredPoint.distance * 1000) {
            // This is the segment the point is in.
            // We can't easily slice the points array by distance without pre-calculating,
            // but adding all points of previous segments + the hoveredPoint is a great visual approx.
            break;
          }
          seg.points.forEach(p => cutPath.push([p.lat, p.lng]));
          currentDist += seg.distance * 1000;
        }
        cutPath.push([hoveredPoint.lat, hoveredPoint.lng]);

        progressLineRef.current = L.polyline(cutPath, {
          color: '#fff', // Bright white to highlight over green
          weight: 5,
          opacity: 0.8,
          lineJoin: 'round',
        }).addTo(map);
      }
    }
  }, [hoveredPoint, segments]);

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
    <div
      ref={divRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
    />
  );
}
