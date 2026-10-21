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
  /**
   * 手動微調／手繪時加入的中間錨點（via points）。
   * 幾何會依序穿過：上一個路點 → via[0] → via[1] → … → 下一個路點。
   * 沒有微調過的電腦路段不會有此欄位。
   */
  via?: LatLng[];
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

export type MapLayer = 'osm' | 'topo' | 'satellite' | 'hm20c';

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
