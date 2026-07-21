import { screenshotDataUrl, type Screenshot } from '@/core/domain/screenshot';

interface ScreenshotStripProps {
  readonly screenshots: readonly Screenshot[];
  readonly max: number;
  readonly onRemove: (index: number) => void;
  readonly onClear: () => void;
}

/**
 * Presentational: the staged screenshot batch (phase 8). Renders each shot as a
 * thumbnail with a remove button, a "N/max" counter, and a clear-all action.
 * Renders nothing when the batch is empty. No logic, no I/O.
 */
export function ScreenshotStrip({ screenshots, max, onRemove, onClear }: ScreenshotStripProps) {
  if (screenshots.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-500">
        <span>
          Скриншоты {screenshots.length}/{max}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-neutral-400 hover:text-neutral-200"
        >
          Очистить всё
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {screenshots.map((shot, index) => (
          <li
            key={`${shot.capturedAt}-${index}`}
            className="relative overflow-hidden rounded-md border border-neutral-700"
          >
            <img
              src={screenshotDataUrl(shot)}
              alt={`Скриншот ${index + 1}: ${shot.width}×${shot.height}`}
              className="block h-16 w-24 bg-neutral-950 object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`Удалить скриншот ${index + 1}`}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded bg-neutral-900/80 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
