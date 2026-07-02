/**
 * Port: control the overlay HUD window.
 *
 * `toggle()` is the direction-agnostic primitive (native flips based on its own
 * `is_visible()`), for callers that just want to flip. `isVisible()` is the
 * read-then-act query for callers that must know the current state *before*
 * acting — e.g. the hotkey captures the screen only when it is about to show,
 * and must do so while the window is still hidden so the HUD stays out of the
 * shot. Both read the same native source of truth, never a client-side flag.
 */
export interface OverlayPort {
  show(): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<void>;
  isVisible(): Promise<boolean>;
}
