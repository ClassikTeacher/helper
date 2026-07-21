import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type { TranscribeResultDto } from '@/core/contracts/dto';
import type { AudioTranscriptionPort } from '@/core/application/ports/audio-transcription.port';

/**
 * Native adapter for AudioTranscriptionPort — the secure-native production path
 * (phase 9). Recording and the STT HTTP call happen entirely in Rust; the audio
 * and the API key never enter this process. Only the transcript string comes
 * back. See architecture.md §3, §6 and decisions.md ADR #14.
 */
export class TauriAudioAdapter implements AudioTranscriptionPort {
  async startRecording(): Promise<void> {
    await invoke<void>(IPC_COMMANDS.audioStartCapture);
  }

  async stopRecording(): Promise<void> {
    await invoke<void>(IPC_COMMANDS.audioStopCapture);
  }

  async transcribe(): Promise<string> {
    const result = await invoke<TranscribeResultDto>(IPC_COMMANDS.transcribeAudio);
    return result.text;
  }
}
