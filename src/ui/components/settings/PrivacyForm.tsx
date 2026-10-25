import type { DataCollection, ProviderSettings } from '@/core/domain/settings';
import { Field, INPUT_CLASS } from './fields';

interface PrivacyFormProps {
  readonly value: ProviderSettings;
  readonly onChange: (patch: Partial<ProviderSettings>) => void;
}

/** Presentational: the OpenRouter provider data policy (F2 / review §2.3). */
export function PrivacyForm({ value, onChange }: PrivacyFormProps) {
  return (
    <div>
      <Field
        label="Данные провайдерам (OpenRouter provider.data_collection)"
        htmlFor="provider-data-collection"
        hint="deny — только провайдеры без хранения/обучения на запросах (скриншоты чужих экранов, голос); allow — любая маршрутизация"
      >
        <select
          id="provider-data-collection"
          className={INPUT_CLASS}
          value={value.dataCollection}
          onChange={(event) => onChange({ dataCollection: event.target.value as DataCollection })}
        >
          <option value="deny">deny (по умолчанию)</option>
          <option value="allow">allow</option>
        </select>
      </Field>
      <Field label="Zero data retention" htmlFor="provider-zdr" hint="только ZDR-эндпоинты: провайдеров меньше, часть моделей может быть недоступна">
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          <input
            id="provider-zdr"
            type="checkbox"
            checked={value.zdr}
            onChange={(event) => onChange({ zdr: event.target.checked })}
          />
          требовать ZDR
        </label>
      </Field>
      <p className="text-[10px] text-neutral-500">
        Переменные <code>AI_HELPER_DATA_COLLECTION</code> / <code>AI_HELPER_ZDR</code> в окружении имеют приоритет.
        История диалогов на диск не пишется; ключ хранится в OS keychain.
      </p>
    </div>
  );
}
