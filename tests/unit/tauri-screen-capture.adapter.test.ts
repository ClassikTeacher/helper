import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import { TauriScreenCaptureAdapter } from '@/infrastructure/tauri/tauri-screen-capture.adapter';
import type { CaptureResultDto } from '@/core/contracts/dto';

const mockInvoke = vi.mocked(invoke);

const result: CaptureResultDto = {
  imageBase64: 'QUJD',
  width: 1568,
  height: 882,
  capturedAt: 1_700_000_000_000,
  source: 'window',
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('TauriScreenCaptureAdapter', () => {
  it('sends an empty request by default (native picks the monitor under the cursor)', async () => {
    mockInvoke.mockResolvedValue({ ...result, source: 'monitor' });
    const shot = await new TauriScreenCaptureAdapter().capture();
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.captureScreen, { request: {} });
    expect(shot.source).toBe('monitor');
  });

  it('passes the active-window target and maps the source back (F5)', async () => {
    mockInvoke.mockResolvedValue(result);
    const shot = await new TauriScreenCaptureAdapter().capture({ target: 'active-window' });
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.captureScreen, {
      request: { target: 'active-window' },
    });
    expect(shot).toEqual({
      imageBase64: 'QUJD',
      width: 1568,
      height: 882,
      capturedAt: 1_700_000_000_000,
      source: 'window',
    });
  });

  it('forwards region and display index unchanged', async () => {
    mockInvoke.mockResolvedValue(result);
    await new TauriScreenCaptureAdapter().capture({
      displayIndex: 1,
      region: { x: 0, y: 0, width: 4, height: 2 },
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.captureScreen, {
      request: { displayIndex: 1, region: { x: 0, y: 0, width: 4, height: 2 } },
    });
  });
});
