import type { OcrText } from '@/core/domain/ocr';
import type { Screenshot } from '@/core/domain/screenshot';

/**
 * Port: recognize text in an image. Optional path (see plan.md phase 6) — the
 * main scenario may instead send the image directly to a multimodal model.
 */
export interface OcrPort {
  recognize(image: Screenshot, languages?: readonly string[]): Promise<OcrText>;
}
