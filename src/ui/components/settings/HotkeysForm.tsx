import { HOTKEY_ACTIONS, type HotkeyAction, type HotkeySettings, type SettingsErrors } from '@/core/domain/settings';
import { Field } from './fields';
import { HotkeyInput } from './HotkeyInput';

const LABELS: Readonly<Record<HotkeyAction, string>> = {
  toggleHud: 'Показать / скрыть HUD',
  capture: 'Скриншот монитора в пакет',
  captureWindow: 'Скриншот активного окна в пакет',
  send: 'Отправить пакет',
  record: 'Запись звука собеседника (вкл/выкл; выкл = отправить)',
  pasteCode: 'Код из буфера обмена',
};

interface HotkeysFormProps {
  readonly value: HotkeySettings;
  readonly errors: SettingsErrors;
  readonly onChange: (patch: Partial<HotkeySettings>) => void;
}

/** Presentational: one accelerator field per hotkey action (F2). */
export function HotkeysForm({ value, errors, onChange }: HotkeysFormProps) {
  return (
    <div>
      <p className="mb-2 text-[10px] text-neutral-500">
        Глобальные сочетания (синтаксис Tauri: модификаторы + клавиша). Применяются сразу после сохранения;
        занятое другим приложением сочетание покажет ошибку в HUD.
      </p>
      {HOTKEY_ACTIONS.map((action) => {
        const error = errors[`hotkeys.${action}`];
        return (
          <Field key={action} label={LABELS[action]} htmlFor={`hotkey-${action}`} error={error}>
            <HotkeyInput
              id={`hotkey-${action}`}
              value={value[action]}
              invalid={Boolean(error)}
              onChange={(next) => onChange({ [action]: next })}
            />
          </Field>
        );
      })}
    </div>
  );
}
