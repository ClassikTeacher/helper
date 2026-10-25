import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import { TauriAudioAdapter } from '@/infrastructure/tauri/tauri-audio.adapter';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('TauriAudioAdapter', () => {
  it('startRecording invokes audio_start_capture and returns the rolling window', async () => {
    mockInvoke.mockResolvedValue({ maxSeconds: 90 });
    const info = await new TauriAudioAdapter().startRecording();
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.audioStartCapture);
    expect(info).toEqual({ maxSeconds: 90 });
  });

  it('stopRecording invokes the audio_stop_capture command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await new TauriAudioAdapter().stopRecording();
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.audioStopCapture);
  });

  it('transcribe invokes transcribe_audio and returns the text field', async () => {
    mockInvoke.mockResolvedValue({ text: 'распознанный текст' });
    const text = await new TauriAudioAdapter().transcribe();
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.transcribeAudio);
    expect(text).toBe('распознанный текст');
  });

  it('with settings sources, the current window and STT options ride along on each call (F2)', async () => {
    let windowSecs = 30;
    const adapter = new TauriAudioAdapter({
      recording: () => ({ windowSecs }),
      stt: () => ({ language: 'en', prompt: 'off', silenceGate: false, silenceDbfs: -40 }),
    });

    mockInvoke.mockResolvedValue({ maxSeconds: 30 });
    await adapter.startRecording();
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.audioStartCapture, { request: { windowSecs: 30 } });

    // Read at call time: a change in settings applies to the next recording.
    windowSecs = 120;
    await adapter.startRecording();
    expect(mockInvoke).toHaveBeenLastCalledWith(IPC_COMMANDS.audioStartCapture, { request: { windowSecs: 120 } });

    mockInvoke.mockResolvedValue({ text: 'hi' });
    await adapter.transcribe();
    expect(mockInvoke).toHaveBeenLastCalledWith(IPC_COMMANDS.transcribeAudio, {
      request: { language: 'en', prompt: 'off', silenceGate: false, silenceDbfs: -40 },
    });
  });
});
