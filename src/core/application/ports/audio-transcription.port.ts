/**
 * Port: record loopback audio (the output device / interlocutor's voice) and
 * transcribe it to text via cloud STT (phase 9). Toggle-driven, not a live
 * stream: `startRecording` begins capture, `stopRecording` ends it, and
 * `transcribe` uploads whatever was captured and returns the recognized text.
 *
 * Secure-native: the concrete Tauri adapter forwards to native commands that
 * keep the audio and the API key in the Rust core — neither ever enters the
 * renderer, only the resulting transcript string does.
 */
export interface AudioTranscriptionPort {
  /** Begin capturing loopback audio, discarding anything previously buffered. */
  startRecording(): Promise<void>;
  /** Stop capturing. Buffered audio is retained until `transcribe`. */
  stopRecording(): Promise<void>;
  /**
   * Transcribe the captured audio and return the text. Resolves to an empty
   * string when nothing was captured (e.g. silence) — that is not an error.
   */
  transcribe(): Promise<string>;
}
