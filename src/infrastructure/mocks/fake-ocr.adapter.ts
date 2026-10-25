import type { OcrPort } from '@/core/application/ports/ocr.port';
import type { OcrText } from '@/core/domain/ocr';
import type { Screenshot } from '@/core/domain/screenshot';

/**
 * OcrPort for dev/tests — no native calls. Returns a fixed text for every
 * image ('' by default: in a plain browser the OCR pass then adds nothing).
 */
export class FakeOcrAdapter implements OcrPort {
  readonly calls: Screenshot[] = [];

  constructor(private readonly text = '') {}

  async recognize(image: Screenshot): Promise<OcrText> {
    this.calls.push(image);
    return { fullText: this.text, boxes: [] };
  }
}
