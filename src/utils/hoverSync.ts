/**
 * HoverSync provides a high-performance bridge for bidirectional sync.
 * It uses absolute distance as the common key.
 */

type SyncPayload = {
  distance: number; // Absolute distance from start (km)
  lat: number;
  lng: number;
  elevation: number;
} | null;

type HoverListener = (payload: SyncPayload, source: 'map' | 'chart') => void;

class HoverSync {
  private listeners: HoverListener[] = [];

  subscribe(listener: HoverListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  emit(payload: SyncPayload, source: 'map' | 'chart') {
    this.listeners.forEach(l => l(payload, source));
  }
}

export const hoverSync = new HoverSync();
