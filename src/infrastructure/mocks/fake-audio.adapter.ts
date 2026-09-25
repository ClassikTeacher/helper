import type {
  AudioTranscriptionPort,
  RecordingInfo,
} from '@/core/application/ports/audio-transcription.port';

/**
 * AudioTranscriptionPort for dev/tests — no native calls. Returns a fixed
 * transcript and records whether it is currently "recording" so tests can
 * assert the toggle/transcribe sequence.
 */
export class FakeAudioAdapter implements AudioTranscriptionPort {
  recording = false;

  constructor(private readonly transcript = '') {}

  async startRecording(): Promise<RecordingInfo> {
    this.recording = true;
    return { maxSeconds: 60 };
  }

  async stopRecording(): Promise<void> {
    this.recording = false;
  }

  async transcribe(): Promise<string> {
    return this.transcript;
  }
}
