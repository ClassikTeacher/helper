//! Infrastructure — concrete implementations of the ports. Swappable per phase.

pub mod audio;
pub mod foreground_window;
pub mod image;
pub mod keyring_secrets;
pub mod llm_cancel;
pub mod ocr;
pub mod openrouter_client;
pub mod ort_ocr;
pub mod scap_capturer;
pub mod stt_client;
pub mod wasapi_loopback;
