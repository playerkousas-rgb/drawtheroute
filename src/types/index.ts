export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutePoint extends LatLng {
  elevation: number;
  distanceFromStart: number;
}

export interface RouteSegment {
  id: string;
  points: RoutePoint[];
  mode: 'auto' | 'straight';
  distance: number;
  ascent: number;
  descent: number;
}

export interface RouteStats {
  totalDistance: number;
  totalAscent: number;
  totalDescent: number;
  maxElevation: number;
  minElevation: number;
  estimatedTime: number;
}

export interface NaismithSettings {
  baseSpeedKmh: number;
  ascentPer20m: number;
  descentPer20m: number;
}

export type MapLayer = 'osm' | 'topo' | 'satellite';

export interface WaypointMarker {
  id: string;
  latlng: LatLng;
  elevation: number;
  type: 'start' | 'waypoint' | 'end';
}

export interface ElevationProfilePoint {
  distance: number;
  elevation: number;
  lat: number;
  lng: number;
}
