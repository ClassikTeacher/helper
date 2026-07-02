import { screenshotDataUrl, type Screenshot } from '@/core/domain/screenshot';

interface ScreenshotPreviewProps {
  readonly screenshot: Screenshot | null;
}

/**
 * Presentational: renders the captured screenshot as a data-URL image. Renders
 * nothing when there is no screenshot yet. No logic, no I/O.
 */
export function ScreenshotPreview({ screenshot }: ScreenshotPreviewProps) {
  if (!screenshot) return null;

  return (
    <figure className="mb-3 overflow-hidden rounded-md border border-neutral-700">
      <img
        src={screenshotDataUrl(screenshot)}
        alt="Captured screen"
        className="block max-h-[200px] w-full bg-neutral-950 object-contain"
      />
      <figcaption className="px-2 py-1 text-[10px] text-neutral-500">
        {screenshot.width}×{screenshot.height}
      </figcaption>
    </figure>
  );
}
