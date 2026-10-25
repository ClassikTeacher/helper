import { useState, type KeyboardEvent } from 'react';
import { acceleratorFromKeyPress } from '@/ui/lib/accelerator';
import { INPUT_CLASS, SMALL_BUTTON_CLASS } from './fields';

interface HotkeyInputProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
}

/**
 * An accelerator field: type it, or press "⌨" and then the combination —
 * the physical keys become `CommandOrControl+Alt+Shift+K`. Presentational.
 */
export function HotkeyInput({ id, value, onChange, invalid = false }: HotkeyInputProps) {
  const [capturing, setCapturing] = useState(false);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!capturing) return;
    event.preventDefault();
    const accelerator = acceleratorFromKeyPress(event);
    if (accelerator) {
      onChange(accelerator);
      setCapturing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        className={INPUT_CLASS}
        value={value}
        placeholder={capturing ? 'Нажмите сочетание клавиш…' : 'CommandOrControl+Alt+Shift+K'}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setCapturing(false)}
      />
      <button
        type="button"
        className={SMALL_BUTTON_CLASS}
        aria-pressed={capturing}
        title="Нажать сочетание вместо ввода"
        onClick={() => setCapturing((on) => !on)}
      >
        {capturing ? 'Жду…' : '⌨'}
      </button>
    </div>
  );
}
