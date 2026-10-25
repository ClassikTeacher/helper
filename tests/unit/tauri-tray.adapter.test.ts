import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import { listen } from '@tauri-apps/api/event';
import { IPC_EVENTS } from '@/core/contracts/ipc-events';
import { TauriTrayAdapter } from '@/infrastructure/tauri/tauri-tray.adapter';

const mockListen = vi.mocked(listen);

type Handler = (event: { payload: unknown }) => void;

beforeEach(() => {
  mockListen.mockReset();
});

describe('TauriTrayAdapter', () => {
  it('subscribes to tray://action and forwards known actions', async () => {
    let handler: Handler | null = null;
    const unlisten = vi.fn();
    mockListen.mockImplementation(async (_event: string, cb: unknown) => {
      handler = cb as Handler;
      return unlisten;
    });
    const received: string[] = [];

    const dispose = await new TauriTrayAdapter().onAction((action) => received.push(action));

    expect(mockListen).toHaveBeenCalledWith(IPC_EVENTS.trayAction, expect.any(Function));
    handler!({ payload: { action: 'stop-recording' } });
    expect(received).toEqual(['stop-recording']);

    dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown or malformed payloads instead of throwing', async () => {
    let handler: Handler | null = null;
    mockListen.mockImplementation(async (_event: string, cb: unknown) => {
      handler = cb as Handler;
      return () => {};
    });
    const received: string[] = [];
    await new TauriTrayAdapter().onAction((action) => received.push(action));

    handler!({ payload: { action: 'self-destruct' } });
    handler!({ payload: null });
    handler!({ payload: {} });

    expect(received).toEqual([]);
  });
});
