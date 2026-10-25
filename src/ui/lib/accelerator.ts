/**
 * Builds a Tauri accelerator (`CommandOrControl+Alt+Shift+K`) from a key
 * press, for the "press the combination" button of the hotkey settings (F2).
 * Works on the physical key (`event.code`), so a Cyrillic layout still yields
 * the Latin letter the global-shortcut plugin expects. Returns `null` for a
 * modifier-only press or an unsupported key. Pure.
 */
export interface KeyPress {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

const KEY_BY_CODE: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  NumpadAdd: 'NumAdd',
  NumpadSubtract: 'NumSub',
  NumpadMultiply: 'NumMult',
  NumpadDivide: 'NumDiv',
  NumpadDecimal: 'NumDec',
};

export function acceleratorFromKeyPress(press: KeyPress): string | null {
  const key = keyToken(press.code);
  if (!key) return null;
  const modifiers: string[] = [];
  if (press.ctrlKey) modifiers.push('CommandOrControl');
  if (press.altKey) modifiers.push('Alt');
  if (press.shiftKey) modifiers.push('Shift');
  if (press.metaKey) modifiers.push('Super');
  return [...modifiers, key].join('+');
}

function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return KEY_BY_CODE[code] ?? null;
}
