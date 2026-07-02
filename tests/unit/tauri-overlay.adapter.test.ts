import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}));

import { invoke } from '@tauri-apps/api/core';
import { TauriOverlayAdapter } from '@/infrastructure/tauri/tauri-overlay.adapter';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';

describe('TauriOverlayAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('show/hide call their dedicated native commands', async () => {
    const adapter = new TauriOverlayAdapter();

    await adapter.show();
    await adapter.hide();

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_COMMANDS.overlayShow);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_COMMANDS.overlayHide);
  });

  it('toggle always delegates to native (no locally-tracked visibility state)', async () => {
    // Regression test: two toggles in a row must both hit `overlay_toggle` —
    // there is no client-side boolean that could get out of sync with the
    // real (native-owned) window visibility.
    const adapter = new TauriOverlayAdapter();

    await adapter.toggle();
    await adapter.toggle();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, IPC_COMMANDS.overlayToggle);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_COMMANDS.overlayToggle);
  });

  it('isVisible reads native visibility and returns the boolean', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    const adapter = new TauriOverlayAdapter();

    const visible = await adapter.isVisible();

    expect(invoke).toHaveBeenCalledWith(IPC_COMMANDS.overlayIsVisible);
    expect(visible).toBe(true);
  });
});
