import { describe, it, expect } from 'vitest';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import libRs from '../../src-tauri/src/lib.rs?raw';

/**
 * Contract drift guard for command NAMES (2026-10 review §5.2): the TS
 * constants must be exactly the commands Rust registers — no command the
 * webview can call that TS does not know about (that is how `secret_get`
 * went unnoticed), and no TS constant without a native implementation. The
 * DTO shapes are guarded by `dto-fixtures.generated.ts` (type-checked).
 */
const commandSources = import.meta.glob('../../src-tauri/src/commands/*.rs', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Command names registered in `tauri::generate_handler![...]` (last path segment). */
function registeredCommands(source: string): string[] {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .flatMap((line) => line.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.split('::').pop()!);
}

describe('IPC command contract', () => {
  const registered = registeredCommands(libRs);
  const declared = Object.values(IPC_COMMANDS) as string[];

  it('finds the handler registration in lib.rs', () => {
    expect(registered.length).toBeGreaterThan(5);
  });

  it('IPC_COMMANDS and generate_handler! name exactly the same commands', () => {
    expect([...declared].sort()).toEqual([...registered].sort());
  });

  it('every registered command is a #[tauri::command] function in src-tauri/src/commands', () => {
    const sources = Object.values(commandSources).join('\n');
    for (const name of registered) {
      const definition = new RegExp(
        `#\\[tauri::command(\\([^)]*\\))?\\]\\s*pub\\s+(async\\s+)?fn\\s+${name}\\s*\\(`,
      );
      expect(sources, `${name} has no #[tauri::command] definition`).toMatch(definition);
    }
  });

  it('exposes no command that could return a secret value', () => {
    expect(registered.filter((name) => name.startsWith('secret_')).sort()).toEqual([
      'secret_delete',
      'secret_has',
      'secret_set',
    ]);
  });
});
