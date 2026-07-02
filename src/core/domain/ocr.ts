/**
 * Domain entity: OCR result over a screenshot. Pure data.
 */
export interface OcrBox {
  readonly text: string;
  readonly confidence: number;
}

export interface OcrText {
  readonly fullText: string;
  readonly boxes: readonly OcrBox[];
}

export function hasText(ocr: OcrText): boolean {
  return ocr.fullText.trim().length > 0;
}
