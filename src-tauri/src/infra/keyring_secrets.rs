//! `SecretStore` implementation backed by the real OS credential store via the
//! `keyring` crate. Replaces the phase-0 in-memory stub (secrets did NOT
//! survive a restart there) — this is what actually makes the secure-native
//! `llm_stream` command usable end-to-end: `secret_set` (from the settings UI)
//! now persists across app restarts, so the key only has to be entered once.
//!
//! Only the `windows-native` backend (Windows Credential Manager) is enabled
//! right now — see the `keyring` dependency comment in `Cargo.toml` for why
//! Linux/macOS backends are deferred rather than guessed at (KISS/YAGNI).

use keyring::Entry;

use crate::ports::SecretStore;

/// Groups every secret this app stores under one Credential-Manager "service"
/// name, so they're identifiable as a set (e.g. via `cmdkey /list` on
/// Windows). Individual secrets — currently just the OpenRouter API key, see
/// `SECRET_KEYS` in `secrets.port.ts` — are distinguished by the `key`
/// argument to `get`/`set`, which becomes the entry's "user" field.
const SERVICE: &str = "ai-helper";

pub struct KeyringSecrets;

impl KeyringSecrets {
    pub fn new() -> Self {
        Self
    }

    fn entry(key: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }
}

impl Default for KeyringSecrets {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringSecrets {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            // "Not set yet" is an expected outcome (e.g. before the user has
            // entered a key), not an error the caller should have to handle.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        Self::entry(key)?.set_password(value).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the REAL Windows Credential Manager — there is no fake/mock
    // to unit-test against here, since the whole point of this module is the
    // OS integration itself (same reasoning as `scap`'s capture path being
    // manually tested rather than unit-tested, see decisions.md). Uses a
    // dedicated test key so it can never collide with the app's real
    // `openrouter.api_key` entry, and cleans up both before (in case a
    // previous run crashed mid-test) and after itself.
    //
    // Ignored by default: `cargo test` should not depend on/mutate real OS
    // credential-store state in every environment (e.g. a locked-down CI
    // runner might not have one). Run explicitly on a real desktop with:
    //   cargo test --lib keyring_secrets -- --ignored
    #[test]
    #[ignore]
    fn round_trips_a_secret_through_the_real_os_credential_store() {
        let store = KeyringSecrets::new();
        let key = "ai-helper-test.round-trip";
        let cleanup = || {
            let _ = KeyringSecrets::entry(key).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
        };
        cleanup();

        assert_eq!(store.get(key).unwrap(), None);

        store.set(key, "s3cr3t").unwrap();
        assert_eq!(store.get(key).unwrap(), Some("s3cr3t".to_string()));

        store.set(key, "updated").unwrap();
        assert_eq!(store.get(key).unwrap(), Some("updated".to_string()));

        cleanup();
        assert_eq!(store.get(key).unwrap(), None);
    }
}
