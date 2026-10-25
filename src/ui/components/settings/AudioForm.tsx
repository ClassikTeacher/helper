import {
  RECORDING_WINDOW_LIMITS,
  SILENCE_DBFS_LIMITS,
  type RecordingSettings,
  type SettingsErrors,
  type SttSettings,
} from '@/core/domain/settings';
import { Field, INPUT_CLASS, numberFromInput } from './fields';

interface AudioFormProps {
  readonly stt: SttSettings;
  readonly recording: RecordingSettings;
  readonly errors: SettingsErrors;
  readonly onChange: (patch: { stt?: Partial<SttSettings>; recording?: Partial<RecordingSettings> }) => void;
}

/** Presentational: STT and recording-window settings (F2). */
export function AudioForm({ stt, recording, errors, onChange }: AudioFormProps) {
  return (
    <div>
      <Field
        label="Язык речи (Whisper)"
        htmlFor="stt-language"
        hint="ru, en, de… или auto — определять автоматически"
        error={errors['stt.language']}
      >
        <input
          id="stt-language"
          type="text"
          className={INPUT_CLASS}
          value={stt.language}
          onChange={(event) => onChange({ stt: { language: event.target.value } })}
        />
      </Field>
      <Field
        label="Подсказка словаря (Whisper prompt)"
        htmlFor="stt-prompt"
        hint="пусто — встроенный словарь собеседования; off — без подсказки; иначе ваши термины"
        error={errors['stt.prompt']}
      >
        <textarea
          id="stt-prompt"
          rows={2}
          className={INPUT_CLASS}
          value={stt.prompt}
          onChange={(event) => onChange({ stt: { prompt: event.target.value } })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Гейт тишины" htmlFor="stt-gate" hint="тихая запись не отправляется, речь обрезается">
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input
              id="stt-gate"
              type="checkbox"
              checked={stt.silenceGate}
              onChange={(event) => onChange({ stt: { silenceGate: event.target.checked } })}
            />
            включён
          </label>
        </Field>
        <Field
          label="Порог тишины, dBFS"
          htmlFor="stt-dbfs"
          hint={`${SILENCE_DBFS_LIMITS.min}…${SILENCE_DBFS_LIMITS.max}; −50 по умолчанию`}
          error={errors['stt.silenceDbfs']}
        >
          <input
            id="stt-dbfs"
            type="number"
            min={SILENCE_DBFS_LIMITS.min}
            max={SILENCE_DBFS_LIMITS.max}
            disabled={!stt.silenceGate}
            className={INPUT_CLASS}
            value={Number.isFinite(stt.silenceDbfs) ? stt.silenceDbfs : ''}
            onChange={(event) => onChange({ stt: { silenceDbfs: numberFromInput(event.target.value) } })}
          />
        </Field>
      </div>
      <Field
        label="Окно записи, с"
        htmlFor="recording-window"
        hint={`в запрос уходят последние N секунд; ${RECORDING_WINDOW_LIMITS.min}–${RECORDING_WINDOW_LIMITS.max}`}
        error={errors['recording.windowSecs']}
      >
        <input
          id="recording-window"
          type="number"
          min={RECORDING_WINDOW_LIMITS.min}
          max={RECORDING_WINDOW_LIMITS.max}
          className={INPUT_CLASS}
          value={Number.isFinite(recording.windowSecs) ? recording.windowSecs : ''}
          onChange={(event) => onChange({ recording: { windowSecs: numberFromInput(event.target.value) } })}
        />
      </Field>
      <p className="text-[10px] text-neutral-500">
        Переменные <code>AI_HELPER_STT_*</code> / <code>AI_HELPER_MAX_RECORDING_SECS</code> в окружении приложения
        имеют приоритет над этими настройками.
      </p>
    </div>
  );
}
