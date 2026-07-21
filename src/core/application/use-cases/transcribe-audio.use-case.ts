import type { AudioTranscriptionPort } from '@/core/application/ports/audio-transcription.port';

/**
 * Use-case: control loopback recording and transcribe it (phase 9). Thin seam
 * over `AudioTranscriptionPort` that the UI (record button) and bootstrap
 * (record hotkey + send flow) reach through DI — so neither touches the adapter
 * directly (architecture.md §8). Kept as a use-case rather than a `platform`
 * port because both React and non-React code need it.
 */
export class TranscribeAudioUseCase {
  constructor(private readonly audio: AudioTranscriptionPort) {}

  startRecording(): Promise<void> {
    return this.audio.startRecording();
  }

  stopRecording(): Promise<void> {
    return this.audio.stopRecording();
  }

  transcribe(): Promise<string> {
    return this.audio.transcribe();
  }
}
