//! Secret commands — the webview's ONLY access to the OS keychain, and it is
//! write-only: the webview may ask whether a secret exists, store one, or
//! delete one, but it can never read a value back. Values are read only by
//! native code at the moment it makes the provider call (`llm_stream`,
//! `transcribe_audio`). That is the secure-native invariant of ADR #7 /
//! architecture.md §11 — a `secret_get` command used to exist here and
//! defeated it (2026-10 review, §2.1): any code running in the webview could
//! `invoke('secret_get')` and exfiltrate the key.
//!
//! Keys are restricted to a fixed allow-list, so the webview cannot use the
//! credential store as a general-purpose vault either.

use tauri::State;

use crate::dto::{SecretHasResult, SecretKeyRequest, SecretSetRequest};
use crate::ports::SecretStore;
use crate::AppState;

/// `SecretStore` key for the OpenRouter API key. MUST match
/// `SECRET_KEYS.openRouterApiKey` in `core/application/ports/secrets.port.ts`
/// — this string is the only thing tying the two sides together (there is no
/// shared enum across the Rust/TS seam for secret keys). Shared by every
/// native reader (`llm_stream`, `transcribe_audio`).
pub const OPENROUTER_API_KEY_SECRET: &str = "openrouter.api_key";

/// Every key the webview may touch. Anything else is rejected before the
/// keychain is consulted.
const ALLOWED_SECRET_KEYS: &[&str] = &[OPENROUTER_API_KEY_SECRET];

fn ensure_allowed(key: &str) -> Result<(), String> {
    if ALLOWED_SECRET_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("unknown secret key `{key}`"))
    }
}

/// Whether a non-empty value is stored under `key`. Only the boolean leaves
/// native; a blank value counts as "not set", matching how `llm_stream` treats
/// the key. Pure over the port — unit-tested with an in-memory store.
pub fn secret_is_set(store: &dyn SecretStore, key: &str) -> Result<bool, String> {
    Ok(store.get(key)?.is_some_and(|value| !value.trim().is_empty()))
}

#[tauri::command]
pub fn secret_has(
    state: State<'_, AppState>,
    request: SecretKeyRequest,
) -> Result<SecretHasResult, String> {
    ensure_allowed(&request.key)?;
    Ok(SecretHasResult {
        exists: secret_is_set(state.secrets.as_ref(), &request.key)?,
    })
}

/// The one moment a secret value crosses the seam: INTO native, when the user
/// types it in settings.
#[tauri::command]
pub fn secret_set(state: State<'_, AppState>, request: SecretSetRequest) -> Result<(), String> {
    ensure_allowed(&request.key)?;
    state.secrets.set(&request.key, &request.value)
}

#[tauri::command]
pub fn secret_delete(state: State<'_, AppState>, request: SecretKeyRequest) -> Result<(), String> {
    ensure_allowed(&request.key)?;
    state.secrets.delete(&request.key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemStore(Mutex<HashMap<String, String>>);

    impl SecretStore for MemStore {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            self.0.lock().unwrap().insert(key.to_string(), value.to_string());
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn only_the_openrouter_key_is_allowed() {
        assert!(ensure_allowed(OPENROUTER_API_KEY_SECRET).is_ok());
        for key in ["", "openrouter.api_key ", "windows.login", "../anything"] {
            assert!(ensure_allowed(key).is_err(), "{key:?} must be rejected");
        }
    }

    #[test]
    fn secret_is_set_reports_only_non_blank_values_and_never_the_value() {
        let store = MemStore::default();
        assert!(!secret_is_set(&store, OPENROUTER_API_KEY_SECRET).unwrap());

        store.set(OPENROUTER_API_KEY_SECRET, "   ").unwrap();
        assert!(!secret_is_set(&store, OPENROUTER_API_KEY_SECRET).unwrap());

        store.set(OPENROUTER_API_KEY_SECRET, "sk-or-v1-x").unwrap();
        assert!(secret_is_set(&store, OPENROUTER_API_KEY_SECRET).unwrap());

        store.delete(OPENROUTER_API_KEY_SECRET).unwrap();
        assert!(!secret_is_set(&store, OPENROUTER_API_KEY_SECRET).unwrap());
    }

    #[test]
    fn the_wire_key_matches_the_ts_constant() {
        // `SECRET_KEYS.openRouterApiKey` in secrets.port.ts — the seam string.
        assert_eq!(OPENROUTER_API_KEY_SECRET, "openrouter.api_key");
    }
}
