/**
 * IPC command names (webview -> Rust core) invoked via `@tauri-apps/api` `invoke`.
 *
 * These string constants are part of the contract seam and MUST match the
 * `#[tauri::command]` names registered in `src-tauri/src/lib.rs`.
 */
export const IPC_COMMANDS = {
  captureScreen: 'capture_screen',
  ocrImage: 'ocr_image',
  /**
   * Secure-native LLM streaming. The webview passes an `LlmStreamRequestDto`
   * plus a Tauri `Channel<LlmChunkDto>`; native reads the key from the keychain,
   * calls OpenRouter, and streams chunks back over the channel. The key never
   * enters the renderer. See architecture.md §3, §6.
   */
  llmStream: 'llm_stream',
  secretGet: 'secret_get',
  secretSet: 'secret_set',
  /**
   * Audio → STT (phase 9). `audioStartCapture`/`audioStopCapture` toggle native
   * WASAPI loopback recording (no payload); `transcribeAudio` drains the buffer,
   * uploads it to the STT endpoint, and returns a `TranscribeResultDto`. The
   * recorded audio never enters the renderer — only the transcript. Secure-native,
   * same shape as `llmStream`.
   */
  audioStartCapture: 'audio_start_capture',
  audioStopCapture: 'audio_stop_capture',
  transcribeAudio: 'transcribe_audio',
  overlayShow: 'overlay_show',
  overlayHide: 'overlay_hide',
  /** Toggles based on the window's real OS-level visibility (native is the source of truth). */
  overlayToggle: 'overlay_toggle',
  /** Reads the window's real OS-level visibility (native is the source of truth). */
  overlayIsVisible: 'overlay_is_visible',
} as const;

export type IpcCommandName = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];
