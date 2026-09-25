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
});
