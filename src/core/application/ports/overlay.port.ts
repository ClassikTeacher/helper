/**
 * Port: control the overlay HUD window.
 */
export interface OverlayPort {
  show(): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<void>;
}
