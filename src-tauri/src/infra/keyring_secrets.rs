//! SecretStore implementation.
//!
//! STUB (phase 0): in-memory map so the app runs without the keychain crate.
//! Secrets do NOT persist across restarts here.
//! TODO: replace with the `keyring` crate (OS keychain / Credential Manager).

use std::collections::HashMap;
use std::sync::Mutex;

use crate::ports::SecretStore;

pub struct KeyringSecrets {
    // Interior mutability so a shared &self can read/write.
    store: Mutex<HashMap<String, String>>,
}

impl KeyringSecrets {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for KeyringSecrets {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringSecrets {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        let guard = self.store.lock().map_err(|e| e.to_string())?;
        Ok(guard.get(key).cloned())
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        let mut guard = self.store.lock().map_err(|e| e.to_string())?;
        guard.insert(key.to_string(), value.to_string());
        Ok(())
    }
}
