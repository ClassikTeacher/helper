import type { RunInfo } from '@/ui/store/hud.store';

interface RunInfoLineProps {
  readonly info: RunInfo | null;
}

/**
 * Presentational: one small line under the answer (R9/R19) — which model
 * answered, tokens and cost. Two states are highlighted because they silently
 * change what the user got: an answer from a FALLBACK model (failover, possibly
 * weaker), and a `length` finish (the provider cut the answer short).
 */
export function RunInfoLine({ info }: RunInfoLineProps) {
  if (!info) return null;

  const parts: string[] = [];
  if (info.model) parts.push(info.model);
  if (info.inputTokens !== undefined && info.outputTokens !== undefined) {
    parts.push(`${info.inputTokens}→${info.outputTokens} tok`);
  }
  if (info.cost !== undefined) parts.push(formatCost(info.cost));

  return (
    <div className="mt-2 space-y-1 text-[10px]">
      {parts.length > 0 && (
        <div className={info.fallback ? 'text-amber-400' : 'text-neutral-500'}>
          {info.fallback && 'резервная модель · '}
          {parts.join(' · ')}
        </div>
      )}
      {info.reason === 'length' && (
        <div role="alert" className="text-amber-400">
          ⚠ Ответ обрезан: провайдер остановил генерацию по лимиту длины.
        </div>
      )}
    </div>
  );
}

function formatCost(usd: number): string {
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3)}`;
}
