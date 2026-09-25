//! Cancellation registry for in-flight `llm_stream` requests (P0: stop /
//! supersede a running answer). The webview tags each request with a
//! `requestId`; `llm_cancel(requestId)` wakes that request's `Notify`, and the
//! streaming future races against it — dropping the HTTP response closes the
//! connection, which stops generation (and billing) upstream.
//!
//! Race-safe in both orders: a cancel that arrives BEFORE the stream registers
//! (the two IPC calls are independent) leaves a pre-notified entry, so the
//! stream sees the cancellation the moment it registers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

/// Upper bound on STRAY entries — cancels for a request that never registers
/// or already finished (e.g. Stop pressed just as the answer completed). Only
/// those are evicted at the cap; an entry a running stream waits on never is,
/// or a later Stop for it would wake a fresh Notify nobody listens to.
const MAX_ENTRIES: usize = 256;

struct Entry {
    notify: Arc<Notify>,
    /// A stream registered this id and has not finished yet.
    live: bool,
}

#[derive(Default)]
pub struct CancelRegistry {
    entries: Mutex<HashMap<String, Entry>>,
}

impl CancelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// The `Notify` a stream awaits for cancellation (pre-notified if a cancel
    /// already arrived for this id).
    pub fn register(&self, request_id: &str) -> Arc<Notify> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = entries.entry(request_id.to_string()).or_insert_with(|| Entry {
            notify: Arc::new(Notify::new()),
            live: false,
        });
        entry.live = true;
        entry.notify.clone()
    }

    /// Requests cancellation. `notify_one` stores a permit, so a stream that
    /// registers later still observes it.
    pub fn cancel(&self, request_id: &str) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() >= MAX_ENTRIES && !entries.contains_key(request_id) {
            entries.retain(|_, entry| entry.live);
        }
        entries
            .entry(request_id.to_string())
            .or_insert_with(|| Entry {
                notify: Arc::new(Notify::new()),
                live: false,
            })
            .notify
            .notify_one();
    }

    /// Forgets a finished request.
    pub fn finish(&self, request_id: &str) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.remove(request_id);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap()
    }

    async fn fires(notify: Arc<Notify>) -> bool {
        tokio::time::timeout(Duration::from_millis(50), notify.notified())
            .await
            .is_ok()
    }

    #[test]
    fn cancel_after_register_wakes_the_stream() {
        let registry = CancelRegistry::new();
        let notify = registry.register("a");
        registry.cancel("a");
        assert!(rt().block_on(fires(notify)));
    }

    #[test]
    fn cancel_before_register_is_not_lost() {
        let registry = CancelRegistry::new();
        registry.cancel("early");
        let notify = registry.register("early");
        assert!(rt().block_on(fires(notify)));
    }

    #[test]
    fn an_uncancelled_request_does_not_fire_and_finish_forgets_it() {
        let registry = CancelRegistry::new();
        let notify = registry.register("b");
        assert!(!rt().block_on(fires(notify)));
        registry.finish("b");
        assert_eq!(registry.len(), 0);
    }

    #[test]
    fn eviction_at_the_cap_never_drops_a_running_stream() {
        // Regression (review): clearing everything at the cap orphaned the
        // Notify of a live stream, so a later Stop no longer reached it.
        let registry = CancelRegistry::new();
        let live = registry.register("live");
        for i in 0..(MAX_ENTRIES * 2) {
            registry.cancel(&format!("stray-{i}"));
        }
        registry.cancel("live");
        assert!(rt().block_on(fires(live)));
    }

    #[test]
    fn stray_cancels_stay_bounded() {
        let registry = CancelRegistry::new();
        for i in 0..(MAX_ENTRIES * 2) {
            registry.cancel(&format!("stray-{i}"));
        }
        assert!(registry.len() <= MAX_ENTRIES);
    }
}
