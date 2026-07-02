import { describe, it, expect, vi, beforeEach } from 'vitest';

const registeredAccelerators = new Set<string>();

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(),
  unregister: vi.fn(),
  isRegistered: vi.fn(),
}));

import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';
import { TauriHotkeyAdapter } from '@/infrastructure/tauri/tauri-hotkey.adapter';

const ACCELERATOR = 'CommandOrControl+Shift+Space';

function defaultRegisterImpl(accelerator: string) {
  registeredAccelerators.add(accelerator);
  return Promise.resolve();
}

function defaultUnregisterImpl(accelerator: string) {
  registeredAccelerators.delete(accelerator);
  return Promise.resolve();
}

function defaultIsRegisteredImpl(accelerator: string) {
  return Promise.resolve(registeredAccelerators.has(accelerator));
}

describe('TauriHotkeyAdapter', () => {
  beforeEach(() => {
    registeredAccelerators.clear();
    vi.clearAllMocks();
    // `clearAllMocks` only clears call history, not implementations set via
    // `mockImplementation` in an earlier test — reassert the defaults so
    // every test starts from a clean, predictable behavior.
    (register as ReturnType<typeof vi.fn>).mockImplementation(defaultRegisterImpl);
    (unregister as ReturnType<typeof vi.fn>).mockImplementation(defaultUnregisterImpl);
    (isRegistered as ReturnType<typeof vi.fn>).mockImplementation(defaultIsRegisteredImpl);
  });

  it('registers a fresh accelerator directly, without unregistering first', async () => {
    const adapter = new TauriHotkeyAdapter();

    await adapter.register(ACCELERATOR, () => {});

    expect(isRegistered).toHaveBeenCalledWith(ACCELERATOR);
    expect(unregister).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: re-registering the same accelerator unregisters the stale one first', async () => {
    // Regression test for the StrictMode double-invoke race: register ->
    // cleanup-unregister -> register must not reject with "already registered".
    const adapter = new TauriHotkeyAdapter();

    await adapter.register(ACCELERATOR, () => {});
    await adapter.register(ACCELERATOR, () => {});

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith(ACCELERATOR);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('invokes the handler only on key press, not release', async () => {
    const handler = vi.fn();
    const adapter = new TauriHotkeyAdapter();
    await adapter.register(ACCELERATOR, handler);

    type ShortcutCallback = (event: { state: 'Pressed' | 'Released' }) => void;
    const calls = (register as unknown as { mock: { calls: [string, ShortcutCallback][] } }).mock.calls;
    const callback = calls[0]?.[1];
    if (!callback) throw new Error('register was not called');
    callback({ state: 'Released' });
    callback({ state: 'Pressed' });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unregister delegates to the plugin', async () => {
    const adapter = new TauriHotkeyAdapter();
    await adapter.unregister(ACCELERATOR);

    expect(unregister).toHaveBeenCalledWith(ACCELERATOR);
  });

  it('serializes calls in invocation order even if an earlier call resolves later (StrictMode race)', async () => {
    // Regression test: React StrictMode double-invokes the effect as
    // register(A) -> cleanup-unregister(B) -> register(C), all fired
    // near-simultaneously. If B's underlying IPC round-trip happens to
    // resolve AFTER C's registration completes, an unserialized adapter
    // would let B's stale unregister wipe out C's fresh registration,
    // leaving the accelerator unregistered with no visible error — exactly
    // what was observed manually (`Ctrl+Shift+Space` did nothing after the
    // app had already been running for a while).
    const events: string[] = [];
    let registerCallCount = 0;

    (register as ReturnType<typeof vi.fn>).mockImplementation(async (accelerator: string) => {
      registerCallCount += 1;
      const isFirstCall = registerCallCount === 1;
      events.push(`register-start:${isFirstCall ? 'A' : 'C'}`);
      if (isFirstCall) {
        // Call A is deliberately slow — it would finish LAST if calls were
        // allowed to run concurrently instead of being queued in order.
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      registeredAccelerators.add(accelerator);
      events.push(`register-end:${isFirstCall ? 'A' : 'C'}`);
    });
    (unregister as ReturnType<typeof vi.fn>).mockImplementation(async (accelerator: string) => {
      events.push('unregister-start:B');
      registeredAccelerators.delete(accelerator);
      events.push('unregister-end:B');
    });

    const adapter = new TauriHotkeyAdapter();

    const callA = adapter.register(ACCELERATOR, () => {}); // slow register
    const callB = adapter.unregister(ACCELERATOR); // stale cleanup
    const callC = adapter.register(ACCELERATOR, () => {}); // fresh register
    await Promise.all([callA, callB, callC]);

    // The accelerator must end up registered (the last call, C, wins) — never
    // left unregistered by a stale cleanup racing ahead of a later register.
    expect(registeredAccelerators.has(ACCELERATOR)).toBe(true);
    // Operations must run strictly in call order, not IPC-resolution order.
    expect(events).toEqual([
      'register-start:A',
      'register-end:A',
      'unregister-start:B',
      'unregister-end:B',
      'register-start:C',
      'register-end:C',
    ]);
  });
});
