//! The foreground (active) top-level window, for the active-window capture
//! (F5, 2026-10 review §4.4). The OS call is confined here; the decision of
//! whether that window is worth capturing is a pure function.

/// What the OS reports as the active window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ForegroundWindow {
    /// Native handle (Windows `HWND`) as an integer — only ever compared, never
    /// dereferenced here.
    pub hwnd: isize,
    /// Minimized windows have no pixels to capture (WGC rejects them).
    pub minimized: bool,
}

/// The current foreground window, if the OS has one.
#[cfg(windows)]
pub fn foreground_window() -> Option<ForegroundWindow> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsIconic};

    // SAFETY: plain Win32 queries that take/return handles only; no memory of
    // ours is handed to the OS.
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }
    let minimized = unsafe { IsIconic(hwnd) } != 0;
    Some(ForegroundWindow {
        hwnd: hwnd as isize,
        minimized,
    })
}

/// No foreground-window query on other platforms yet: the command falls back
/// to the monitor under the cursor.
#[cfg(not(windows))]
pub fn foreground_window() -> Option<ForegroundWindow> {
    None
}

/// Which window to capture, if any: the foreground window — unless there is
/// none, it is minimized, or it is our own HUD (the user may have just
/// clicked it; a screenshot of the HUD is never what they want). `None`
/// means "capture the monitor instead". Pure.
pub fn pick_window(foreground: Option<ForegroundWindow>, hud: Option<isize>) -> Option<isize> {
    let window = foreground?;
    if window.minimized || Some(window.hwnd) == hud {
        return None;
    }
    Some(window.hwnd)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fg(hwnd: isize, minimized: bool) -> Option<ForegroundWindow> {
        Some(ForegroundWindow { hwnd, minimized })
    }

    #[test]
    fn picks_the_foreground_window_when_it_is_a_normal_other_window() {
        assert_eq!(pick_window(fg(0x1234, false), Some(0x99)), Some(0x1234));
        assert_eq!(pick_window(fg(0x1234, false), None), Some(0x1234));
    }

    #[test]
    fn falls_back_when_there_is_no_window_it_is_minimized_or_it_is_the_hud() {
        assert_eq!(pick_window(None, Some(0x99)), None);
        assert_eq!(pick_window(fg(0x1234, true), Some(0x99)), None);
        assert_eq!(pick_window(fg(0x99, false), Some(0x99)), None);
    }
}
