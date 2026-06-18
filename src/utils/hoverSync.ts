/**
 * HoverSync provides a simple event-based mechanism to sync the elevation chart hover
 * with the map marker without triggering React re-renders of the entire application.
 */

type HoverPoint = {
  lat: number;
  lng: number;
  elevation: number;
  distance: number;
} | null;

type HoverListener = (point: HoverPoint) => void;

class HoverSync {
  private listeners: HoverListener[] = [];

  /**
   * Subscribe to hover updates.
   */
  subscribe(listener: HoverListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit a hover update to all subscribers.
   */
  emit(point: HoverPoint) {
    this.listeners.forEach(l => l(point));
  }
}

export const hoverSync = new HoverSync();
