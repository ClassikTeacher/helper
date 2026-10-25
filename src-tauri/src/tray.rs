//! System tray (F1, 2026-10 review §4.1 / tasks.md phase 13).
//!
//! The HUD starts hidden and lives off global hotkeys, so without a tray the
//! resident app has no visible handle: no way to quit except the task manager,
//! and no sign that loopback recording is running while the HUD is hidden. The
//! tray gives both — a menu (show/hide HUD, stop recording, autostart, quit)
//! and a **recording indicator**: the icon gets a red badge and the tooltip
//! counts the seconds. The indicator is driven from the native
//! `audio_start_capture`/`audio_stop_capture` commands, not from the webview,
//! so it cannot disagree with what the recorder actually does.
//!
//! "Stop recording" is forwarded to the webview as the `tray://action` event
//! (`IPC_EVENTS.trayAction`): stopping a recording means "send the question"
//! (phase 9), and that flow — transcription, the staged batch, the dialog —
//! lives in the webview. Show/hide, autostart and quit are handled natively.
//!
//! Everything with geometry or text in it is a pure function (unit-tested);
//! the Tauri calls are confined to `Tray::install`/`set_recording`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::commands::toggle_main_window;
use crate::dto::TrayActionPayload;

/// Id of the app's single tray icon (`app.tray_by_id`).
pub const TRAY_ID: &str = "main";

/// Event carrying a tray action the webview must carry out. Mirrors
/// `IPC_EVENTS.trayAction` in `core/contracts/ipc-events.ts`.
pub const TRAY_ACTION_EVENT: &str = "tray://action";

const TOOLTIP_IDLE: &str = "AI-Helper";

/// Badge color (red, opaque): what "recording" looks like in the tray.
const BADGE_RGBA: [u8; 4] = [0xE5, 0x48, 0x4D, 0xFF];

/// Fallback icon color (indigo) when the app has no window icon configured.
const FALLBACK_RGBA: [u8; 4] = [0x63, 0x66, 0xF1, 0xFF];

/// The tray menu's actions. Menu ids are stable strings (they are what the
/// menu event carries back); the webview-side names are the `tray://action`
/// payload for actions the webview handles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    ToggleHud,
    StopRecording,
    Autostart,
    Quit,
}

impl TrayAction {
    pub const ALL: [TrayAction; 4] = [
        TrayAction::ToggleHud,
        TrayAction::StopRecording,
        TrayAction::Autostart,
        TrayAction::Quit,
    ];

    pub const fn menu_id(self) -> &'static str {
        match self {
            TrayAction::ToggleHud => "toggle-hud",
            TrayAction::StopRecording => "stop-recording",
            TrayAction::Autostart => "autostart",
            TrayAction::Quit => "quit",
        }
    }

    pub fn from_menu_id(id: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|action| action.menu_id() == id)
    }

    /// The `tray://action` payload for actions the webview carries out
    /// (`TrayAction` in `core/application/ports/tray.port.ts`); `None` for
    /// actions handled natively.
    pub const fn webview_action(self) -> Option<&'static str> {
        match self {
            TrayAction::StopRecording => Some("stop-recording"),
            TrayAction::ToggleHud | TrayAction::Autostart | TrayAction::Quit => None,
        }
    }
}

/// Tooltip text: the app name, plus the recording clock while recording.
pub fn tooltip_for(recording_for: Option<Duration>) -> String {
    match recording_for {
        None => TOOLTIP_IDLE.to_string(),
        Some(elapsed) => {
            let secs = elapsed.as_secs();
            format!("{TOOLTIP_IDLE} — запись {}:{:02}", secs / 60, secs % 60)
        }
    }
}

/// The idle icon with a red disc in the bottom-right corner: the recording
/// indicator. Pure: takes and returns tightly packed RGBA. A buffer that does
/// not match `width × height` is returned unchanged (never panics on a
/// surprising icon).
pub fn recording_badge(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    if width == 0 || height == 0 || out.len() != (width as usize) * (height as usize) * 4 {
        return out;
    }
    // Disc diameter ≈ 60% of the shorter side, tucked into the corner.
    let radius = (width.min(height) as f32 * 0.3).max(2.0);
    let cx = width as f32 - radius;
    let cy = height as f32 - radius;
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy <= radius * radius {
                let i = ((y * width + x) * 4) as usize;
                out[i..i + 4].copy_from_slice(&BADGE_RGBA);
            }
        }
    }
    out
}

/// A solid square used when `tauri.conf.json` has no `bundle.icon` (dev
/// builds): the tray must still exist, or the app cannot be quit.
pub fn fallback_icon(size: u32) -> Vec<u8> {
    FALLBACK_RGBA.repeat((size as usize) * (size as usize))
}

/// The installed tray: icons for both states, the menu items whose state
/// changes, and the recording clock. Managed as Tauri state so commands and
/// the tooltip ticker can reach it.
pub struct Tray {
    idle_icon: Image<'static>,
    recording_icon: Image<'static>,
    stop_item: MenuItem<Wry>,
    autostart_item: CheckMenuItem<Wry>,
    recording_since: Mutex<Option<Instant>>,
    /// Bumped on every recording start; the tooltip ticker of an older
    /// recording stops when it sees a newer generation.
    generation: AtomicU64,
}

impl Tray {
    /// Builds the icon + menu and registers the handlers. Call once in `setup`.
    pub fn install(app: &AppHandle) -> tauri::Result<Self> {
        let (rgba, width, height) = match app.default_window_icon() {
            Some(icon) => (icon.rgba().to_vec(), icon.width(), icon.height()),
            None => (fallback_icon(32), 32, 32),
        };
        let recording_icon = Image::new_owned(recording_badge(&rgba, width, height), width, height);
        let idle_icon = Image::new_owned(rgba, width, height);

        let toggle_item =
            MenuItemBuilder::with_id(TrayAction::ToggleHud.menu_id(), "Показать / скрыть HUD").build(app)?;
        let stop_item = MenuItemBuilder::with_id(
            TrayAction::StopRecording.menu_id(),
            "Остановить запись и отправить",
        )
        .enabled(false)
        .build(app)?;
        let autostart_enabled = app.autolaunch().is_enabled().unwrap_or_else(|e| {
            log::warn!("tray: autostart state unavailable: {e}");
            false
        });
        let autostart_item = CheckMenuItemBuilder::with_id(
            TrayAction::Autostart.menu_id(),
            "Запускать при входе в систему",
        )
        .checked(autostart_enabled)
        .build(app)?;
        let quit_item = MenuItemBuilder::with_id(TrayAction::Quit.menu_id(), "Выход").build(app)?;
        let menu = MenuBuilder::new(app)
            .item(&toggle_item)
            .item(&stop_item)
            .separator()
            .item(&autostart_item)
            .separator()
            .item(&quit_item)
            .build()?;

        TrayIconBuilder::with_id(TRAY_ID)
            .icon(idle_icon.clone())
            .tooltip(TOOLTIP_IDLE)
            .menu(&menu)
            // Left click toggles the HUD; the menu is on the right button.
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| on_menu_event(app, &event))
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if let Err(e) = toggle_main_window(tray.app_handle()) {
                        log::warn!("tray: toggle HUD failed: {e}");
                    }
                }
            })
            .build(app)?;

        log::info!("tray: installed (autostart {})", if autostart_enabled { "on" } else { "off" });
        Ok(Self {
            idle_icon,
            recording_icon,
            stop_item,
            autostart_item,
            recording_since: Mutex::new(None),
            generation: AtomicU64::new(0),
        })
    }

    /// Flip the recording indicator: icon badge, tooltip clock, and the
    /// "stop recording" menu item. Called by the audio commands.
    pub fn set_recording(&self, app: &AppHandle, recording: bool) {
        let since = recording.then(Instant::now);
        if let Ok(mut guard) = self.recording_since.lock() {
            *guard = since;
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Err(e) = self.stop_item.set_enabled(recording) {
            log::warn!("tray: menu update failed: {e}");
        }
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let icon = if recording { &self.recording_icon } else { &self.idle_icon };
            if let Err(e) = tray.set_icon(Some(icon.clone())) {
                log::warn!("tray: icon update failed: {e}");
            }
            let _ = tray.set_tooltip(Some(tooltip_for(since.map(|s| s.elapsed()))));
        }
        if recording {
            spawn_tooltip_ticker(app.clone(), generation);
        }
    }

    /// How long the current recording has been running, if one is.
    pub fn recording_for(&self) -> Option<Duration> {
        self.recording_since
            .lock()
            .ok()
            .and_then(|guard| guard.map(|since| since.elapsed()))
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
}

/// Convenience for the commands: update the indicator if the tray exists
/// (it is installed in `setup`, so it always does once commands can run).
pub fn set_recording(app: &AppHandle, recording: bool) {
    if let Some(tray) = app.try_state::<Tray>() {
        tray.set_recording(app, recording);
    }
}

/// Once a second while the recording of `generation` runs: the tooltip clock.
fn spawn_tooltip_ticker(app: AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let elapsed = app.try_state::<Tray>().and_then(|tray| {
                (tray.generation() == generation).then(|| tray.recording_for()).flatten()
            });
            let Some(elapsed) = elapsed else { break };
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_tooltip(Some(tooltip_for(Some(elapsed))));
            }
        }
    });
}

fn on_menu_event(app: &AppHandle, event: &MenuEvent) {
    let Some(action) = TrayAction::from_menu_id(event.id().0.as_str()) else {
        return;
    };
    match action {
        TrayAction::ToggleHud => {
            if let Err(e) = toggle_main_window(app) {
                log::warn!("tray: toggle HUD failed: {e}");
            }
        }
        TrayAction::StopRecording => {
            // The stop itself lives in the webview (stop = send); native only
            // forwards the request.
            let payload = TrayActionPayload {
                action: action
                    .webview_action()
                    .expect("stop-recording is a webview action")
                    .to_string(),
            };
            if let Err(e) = app.emit(TRAY_ACTION_EVENT, payload) {
                log::warn!("tray: forwarding stop-recording failed: {e}");
            }
        }
        TrayAction::Autostart => toggle_autostart(app),
        TrayAction::Quit => {
            log::info!("tray: quit");
            app.exit(0);
        }
    }
}

/// The check item has already flipped when the event arrives: apply its new
/// state to the OS autostart entry, and flip it back if that fails.
fn toggle_autostart(app: &AppHandle) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let want = tray.autostart_item.is_checked().unwrap_or(false);
    let manager = app.autolaunch();
    let result = if want { manager.enable() } else { manager.disable() };
    match result {
        Ok(()) => log::info!("tray: autostart {}", if want { "enabled" } else { "disabled" }),
        Err(e) => {
            log::warn!("tray: autostart change failed: {e}");
            let _ = tray.autostart_item.set_checked(!want);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_shows_the_app_name_and_the_recording_clock() {
        assert_eq!(tooltip_for(None), "AI-Helper");
        assert_eq!(tooltip_for(Some(Duration::from_secs(0))), "AI-Helper — запись 0:00");
        assert_eq!(tooltip_for(Some(Duration::from_secs(65))), "AI-Helper — запись 1:05");
        assert_eq!(tooltip_for(Some(Duration::from_millis(599_900))), "AI-Helper — запись 9:59");
    }

    #[test]
    fn menu_ids_round_trip_and_only_stop_recording_reaches_the_webview() {
        for action in TrayAction::ALL {
            assert_eq!(TrayAction::from_menu_id(action.menu_id()), Some(action));
        }
        assert_eq!(TrayAction::from_menu_id("unknown"), None);
        assert_eq!(TrayAction::StopRecording.webview_action(), Some("stop-recording"));
        assert_eq!(TrayAction::Quit.webview_action(), None);
    }

    #[test]
    fn recording_badge_paints_a_red_disc_in_the_bottom_right_corner() {
        let (w, h) = (32u32, 32u32);
        let base = vec![0u8; (w * h * 4) as usize];
        let out = recording_badge(&base, w, h);
        assert_eq!(out.len(), base.len());
        let px = |x: u32, y: u32| &out[((y * w + x) * 4) as usize..((y * w + x) * 4 + 4) as usize];
        // Radius 9.6 px centred at (22.4, 22.4): the centre and the edge
        // midpoints are red; the icon's corners (incl. the very corner pixel —
        // a disc, not a square) and the other three quadrants are untouched.
        assert_eq!(px(22, 22), &BADGE_RGBA);
        assert_eq!(px(22, 31), &BADGE_RGBA);
        assert_eq!(px(31, 22), &BADGE_RGBA);
        assert_eq!(px(13, 22), &BADGE_RGBA);
        assert_eq!(px(31, 31), &[0, 0, 0, 0]);
        assert_eq!(px(0, 0), &[0, 0, 0, 0]);
        assert_eq!(px(31, 0), &[0, 0, 0, 0]);
        assert_eq!(px(0, 31), &[0, 0, 0, 0]);
        // A whole disc: π·r² ≈ 290 pixels, give or take the rasterization.
        let red = (0..w * h).filter(|i| out[(i * 4) as usize] == 0xE5).count();
        assert!((240..=340).contains(&red), "red pixels: {red}");
    }

    #[test]
    fn recording_badge_leaves_a_malformed_buffer_alone() {
        let short = vec![7u8; 10];
        assert_eq!(recording_badge(&short, 32, 32), short);
        assert_eq!(recording_badge(&[], 0, 0), Vec::<u8>::new());
    }

    #[test]
    fn fallback_icon_is_a_solid_opaque_square() {
        let icon = fallback_icon(4);
        assert_eq!(icon.len(), 4 * 4 * 4);
        assert!(icon.chunks(4).all(|px| px == FALLBACK_RGBA));
    }
}
