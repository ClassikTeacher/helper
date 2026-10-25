import {
  MAX_IMAGE_EDGE_LIMIT,
  MIN_IMAGE_EDGE_LIMIT,
  MODEL_ROUTES,
  REASONING_EFFORTS,
  type ModelRoute,
  type ReasoningEffort,
} from '@/core/domain/model-route';
import type { RouteSettings, RoutesSettings, SettingsErrors } from '@/core/domain/settings';
import { Field, INPUT_CLASS, numberFromInput } from './fields';

const ROUTE_TITLES: Readonly<Record<ModelRoute, string>> = {
  light: 'light — Solve (скорость)',
  heavy: 'heavy — Review (глубина)',
};

interface RoutesFormProps {
  readonly value: RoutesSettings;
  readonly errors: SettingsErrors;
  readonly onChange: (route: ModelRoute, patch: Partial<RouteSettings>) => void;
}

/**
 * Presentational: the model chain and request profile per route (F2).
 * The chain is one OpenRouter slug per line, primary first; every model must
 * be multimodal (the main scenario always sends a screenshot).
 */
export function RoutesForm({ value, errors, onChange }: RoutesFormProps) {
  return (
    <div>
      <p className="mb-2 text-[10px] text-neutral-500">
        Слаги моделей OpenRouter, по одному в строке: первая — основная, остальные — failover по порядку.
        Все модели должны принимать картинки. Проверить слаги: <code>pnpm models:check</code>.
      </p>
      {MODEL_ROUTES.map((route) => {
        const profile = value[route];
        const prefix = `routes.${route}`;
        return (
          <fieldset key={route} className="mb-3 rounded-md border border-neutral-700/70 p-2">
            <legend className="px-1 text-xs font-medium text-neutral-300">{ROUTE_TITLES[route]}</legend>
            <Field label="Цепочка моделей" htmlFor={`${prefix}-chain`} error={errors[`${prefix}.chain`]}>
              <textarea
                id={`${prefix}-chain`}
                rows={3}
                spellCheck={false}
                className={INPUT_CLASS}
                value={profile.chain.join('\n')}
                onChange={(event) =>
                  onChange(route, {
                    chain: event.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0),
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field
                label="Temperature"
                htmlFor={`${prefix}-temperature`}
                hint="пусто = не отправлять"
                error={errors[`${prefix}.temperature`]}
              >
                <input
                  id={`${prefix}-temperature`}
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  className={INPUT_CLASS}
                  value={profile.temperature ?? ''}
                  onChange={(event) =>
                    onChange(route, {
                      temperature: event.target.value.trim() === '' ? null : numberFromInput(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Reasoning" htmlFor={`${prefix}-reasoning`} error={errors[`${prefix}.reasoningEffort`]}>
                <select
                  id={`${prefix}-reasoning`}
                  className={INPUT_CLASS}
                  value={profile.reasoningEffort ?? 'off'}
                  onChange={(event) =>
                    onChange(route, {
                      reasoningEffort:
                        event.target.value === 'off' ? null : (event.target.value as ReasoningEffort),
                    })
                  }
                >
                  <option value="off">off</option>
                  {REASONING_EFFORTS.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Картинка, px"
                htmlFor={`${prefix}-edge`}
                hint={`${MIN_IMAGE_EDGE_LIMIT}–${MAX_IMAGE_EDGE_LIMIT}`}
                error={errors[`${prefix}.maxImageEdge`]}
              >
                <input
                  id={`${prefix}-edge`}
                  type="number"
                  min={MIN_IMAGE_EDGE_LIMIT}
                  max={MAX_IMAGE_EDGE_LIMIT}
                  className={INPUT_CLASS}
                  value={Number.isFinite(profile.maxImageEdge) ? profile.maxImageEdge : ''}
                  onChange={(event) => onChange(route, { maxImageEdge: numberFromInput(event.target.value) })}
                />
              </Field>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
