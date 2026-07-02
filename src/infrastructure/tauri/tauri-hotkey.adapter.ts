import {
  isRegistered,
  register,
  unregister,
} from '@tauri-apps/plugin-global-shortcut';
import type { HotkeyHandler, HotkeyPort } from '@/core/application/ports/hotkey.port';

/**
 * Native adapter for HotkeyPort — wraps `tauri-plugin-global-shortcut`.
 *
 * All register/unregister calls are serialized through `queue` (FIFO, in
 * *invocation* order — not in whatever order their internal IPC round-trips
 * happen to resolve). This matters because React StrictMode's dev-mode
 * double-invoked effects fire register -> cleanup-unregister -> register in
 * that exact call order, but each call is itself a multi-step async chain
 * (`isRegistered` -> maybe `unregister` -> `register`). Without serialization,
 * the *stale* cleanup's `unregister` can resolve AFTER the second `register`
 * and silently wipe out the accelerator, leaving nothing registered at all —
 * `register`/`unregister` themselves never reject, so this was invisible.
 * Serializing makes the effective execution order match the call order, so
 * the final state always reflects the *last* call, as intended.
 */
export class TauriHotkeyAdapter implements HotkeyPort {
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    // Never let a rejection stall the queue for subsequent operations.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async register(accelerator: string, handler: HotkeyHandler): Promise<void> {
    return this.enqueue(async () => {
      if (await isRegistered(accelerator)) {
        await unregister(accelerator);
      }
      await register(accelerator, (event) => {
        // plugin fires on both press and release in v2; act on press only.
        if (event.state === 'Pressed') handler();
      });
    });
  }

  async unregister(accelerator: string): Promise<void> {
    return this.enqueue(() => unregister(accelerator));
  }
}
