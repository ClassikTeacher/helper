import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type {
  AudioStartRequestDto,
  AudioStartResultDto,
  TranscribeRequestDto,
  TranscribeResultDto,
} from '@/core/contracts/dto';
import type {
  AudioTranscriptionPort,
  RecordingInfo,
} from '@/core/application/ports/audio-transcription.port';
import type { RecordingSettings, SttSettings } from '@/core/domain/settings';

/**
 * Native adapter for AudioTranscriptionPort — the secure-native production path
 * (phase 9). Recording and the STT HTTP call happen entirely in Rust; the audio
 * and the API key never enter this process. Only the transcript string comes
 * back. See architecture.md §3, §6 and decisions.md ADR #14.
 *
 * With `options` (F2) the current settings ride along on each call — the
 * recording window on start, the STT language/prompt/silence gate on
 * transcribe — read at call time so a change in ⚙ applies to the next
 * recording. Without them the commands take no payload and native applies
 * its own defaults (and `AI_HELPER_*` env overrides either way).
 */
export class TauriAudioAdapter implements AudioTranscriptionPort {
  constructor(
    private readonly options: {
      readonly recording?: () => RecordingSettings;
      readonly stt?: () => SttSettings;
    } = {},
  ) {}

  async startRecording(): Promise<RecordingInfo> {
    const recording = this.options.recording?.();
    const result = recording
      ? await invoke<AudioStartResultDto>(IPC_COMMANDS.audioStartCapture, {
          request: { windowSecs: recording.windowSecs } satisfies AudioStartRequestDto,
        })
      : await invoke<AudioStartResultDto>(IPC_COMMANDS.audioStartCapture);
    return { maxSeconds: result.maxSeconds };
  }

  async stopRecording(): Promise<void> {
    await invoke<void>(IPC_COMMANDS.audioStopCapture);
  }

  async transcribe(): Promise<string> {
    const stt = this.options.stt?.();
    const result = stt
      ? await invoke<TranscribeResultDto>(IPC_COMMANDS.transcribeAudio, {
          request: {
            language: stt.language,
            prompt: stt.prompt,
            silenceGate: stt.silenceGate,
            silenceDbfs: stt.silenceDbfs,
          } satisfies TranscribeRequestDto,
        })
      : await invoke<TranscribeResultDto>(IPC_COMMANDS.transcribeAudio);
    return result.text;
  }
}
