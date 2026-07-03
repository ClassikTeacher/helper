/**
 * Port: control the overlay HUD window.
 *
 * `toggle()` is the direction-agnostic primitive (native flips based on its own
 * `is_visible()`), for callers that just want to flip. `isVisible()` is a
 * read query for callers that need to know the current state before acting.
 * Both read the same native source of truth, never a client-side flag.
 *
 * NOTE: the capture flow no longer hides the HUD before taking a shot — the
 * overlay window is content-protected (`WDA_EXCLUDEFROMCAPTURE`), so it is
 * excluded from capture while staying visible. `isVisible()` is therefore not
 * on the hotkey path anymore, but is kept as a general-purpose query.
 */
export interface OverlayPort {
  show(): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<void>;
  isVisible(): Promise<boolean>;
}
