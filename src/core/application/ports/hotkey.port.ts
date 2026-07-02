export type HotkeyHandler = () => void;

/**
 * Port: register global hotkeys. `register` must be idempotent — calling it
 * twice for the same accelerator (e.g. React StrictMode's double-invoked
 * effects) replaces the previous registration instead of throwing.
 */
export interface HotkeyPort {
  register(accelerator: string, handler: HotkeyHandler): Promise<void>;
  unregister(accelerator: string): Promise<void>;
}
