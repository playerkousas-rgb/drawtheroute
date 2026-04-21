import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LatLng, RouteSegment, WaypointMarker, MapLayer, ElevationProfilePoint } from '../../types';

interface MapContainerProps {
  segments: RouteSegment[];
  waypoints: WaypointMarker[];
  mapLayer: MapLayer;
  onMapClick: (latlng: LatLng) => void;
  hoveredProfilePoint: ElevationProfilePoint | null;
  isProcessing: boolean;
}

const TILE_LAYERS: Record<MapLayer, { url: string; attribution: string; maxZoom: number }> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri &mdash; Source: Esri, Maxar, GeoEye',
    maxZoom: 18,
  },
};

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function makeStartIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;background:#22c55e;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px #22c55e,0 0 20px rgba(34,197,94,0.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function makeEndIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px #ef4444,0 0 20px rgba(239,68,68,0.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function makeWaypointIcon(index: number) {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;background:rgba(15,23,42,0.9);border:2px solid #f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px rgba(245,158,11,0.5);font-size:9px;color:#f59e0b;font-family:monospace;font-weight:700">${index}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function makeHoverIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;background:#60a5fa;border:3px solid #fff;border-radius:50%;box-shadow:0 0 14px #60a5fa,0 0 28px rgba(96,165,250,0.5)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export default function MapContainer({
  segments,
  waypoints,
  mapLayer,
  onMapClick,
  hoveredProfilePoint,
  isProcessing,
}: MapContainerProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const routeGroupRef = useRef<L.LayerGroup | null>(null);
  const waypointGroupRef = useRef<L.LayerGroup | null>(null);
  const hoverMarkerRef = useRef<L.Marker | null>(null);

  // Keep latest click handler in ref to avoid stale closure
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: [22.3964, 114.1095],
      zoom: 12,
      zoomControl: false,
      preferCanvas: true,   // ← canvas renderer = faster polylines
    });
    mapRef.current = map;

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Initial tile layer
    const cfg = TILE_LAYERS.topo;
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);

    // Layer groups — always on top of tiles
    routeGroupRef.current = L.layerGroup().addTo(map);
    waypointGroupRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap tile layer when mapLayer prop changes ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    const cfg = TILE_LAYERS[mapLayer];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    });
    // Insert BELOW the route/waypoint groups
    tileLayerRef.current.addTo(map);
    tileLayerRef.current.bringToBack();
  }, [mapLayer]);

  // ── Cursor ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = isProcessing ? 'wait' : 'crosshair';
  }, [isProcessing]);

  // ── Draw route segments ────────────────────────────────────────────────────
  useEffect(() => {
    const group = routeGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    group.clearLayers();

    if (segments.length === 0) return;

    segments.forEach((seg, idx) => {
      if (seg.points.length < 2) return;

      const latlngs: L.LatLngExpression[] = seg.points.map(p => [p.lat, p.lng]);

      // Glow / shadow layer
      L.polyline(latlngs, {
        color: seg.mode === 'auto' ? '#1d4ed8' : '#92400e',
        weight: 8,
        opacity: 0.35,
        smoothFactor: 1.5,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);

      // Main route line
      L.polyline(latlngs, {
        color: seg.mode === 'auto' ? '#60a5fa' : '#fbbf24',
        weight: 4,
        opacity: 1,
        smoothFactor: 1.5,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: seg.mode === 'straight' ? '10 7' : undefined,
      }).addTo(group);

      // Mid-point distance label
      const mid = seg.points[Math.floor(seg.points.length / 2)];
      L.marker([mid.lat, mid.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:rgba(8,14,28,0.88);color:#94a3b8;font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid rgba(148,163,184,0.25);white-space:nowrap;font-family:monospace;backdrop-filter:blur(8px)">§${idx + 1} · ${seg.distance.toFixed(2)} km</div>`,
          iconAnchor: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 100,
      }).addTo(group);
    });

    // LayerGroup doesn't have bringToFront — individual layers handle z-index via zIndexOffset
  }, [segments]);

  // ── Draw waypoint markers ──────────────────────────────────────────────────
  useEffect(() => {
    const group = waypointGroupRef.current;
    if (!group) return;

    group.clearLayers();

    waypoints.forEach((wp, idx) => {
      let icon: L.DivIcon;
      let label: string;

      if (wp.type === 'start') {
        icon = makeStartIcon();
        label = '起點';
      } else if (wp.type === 'end') {
        icon = makeEndIcon();
        label = '終點';
      } else {
        icon = makeWaypointIcon(idx);
        label = `路點 ${idx}`;
      }

      L.marker([wp.latlng.lat, wp.latlng.lng], { icon, zIndexOffset: 500 })
        .bindTooltip(
          `<div style="font-family:monospace;font-size:11px;line-height:1.6">
            <b style="color:#e2e8f0">${label}</b><br/>
            <span style="color:#64748b">${wp.latlng.lat.toFixed(5)}, ${wp.latlng.lng.toFixed(5)}</span><br/>
            <span style="color:#34d399">海拔 ${wp.elevation.toFixed(0)} m</span>
          </div>`,
          { direction: 'top', offset: L.point(0, -12), opacity: 1 }
        )
        .addTo(group);
    });
  }, [waypoints]);

  // ── Elevation profile hover marker ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (hoverMarkerRef.current) {
      map.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }

    if (hoveredProfilePoint) {
      hoverMarkerRef.current = L.marker(
        [hoveredProfilePoint.lat, hoveredProfilePoint.lng],
        { icon: makeHoverIcon(), interactive: false, zIndexOffset: 2000 }
      ).addTo(map);
    }
  }, [hoveredProfilePoint]);

  // ── Auto-fit bounds on new segments ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || segments.length === 0) return;
    const allPts: L.LatLngExpression[] = segments.flatMap(s =>
      s.points.map(p => [p.lat, p.lng] as [number, number])
    );
    if (allPts.length > 1) {
      try {
        map.fitBounds(L.latLngBounds(allPts as L.LatLngBoundsLiteral), {
          padding: [60, 60],
          maxZoom: 15,
          animate: true,
        });
      } catch {
        // ignore invalid bounds
      }
    }
  }, [segments]);

  return (
    <div
      ref={mapDivRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
    />
  );
}
