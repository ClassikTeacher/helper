import type { SettingsDocument } from '@/core/domain/settings';

/**
 * Port: persistence of the user's settings patch (F2). `load` hands back
 * whatever is on disk — unknown, because the file may be absent, old or
 * hand-edited; the use-case sanitizes it. `save` replaces the stored
 * document. Implemented over `tauri-plugin-store` in Tauri and in memory
 * for the browser/tests.
 */
export interface SettingsPort {
  load(): Promise<unknown>;
  save(document: SettingsDocument): Promise<void>;
}
