import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type { OcrRequestDto, OcrResultDto } from '@/core/contracts/dto';
import type { OcrPort } from '@/core/application/ports/ocr.port';
import type { OcrText } from '@/core/domain/ocr';
import type { Screenshot } from '@/core/domain/screenshot';

/**
 * Native adapter for OcrPort — delegates to the Rust `ocr_image` command.
 * Optional path (plan.md phase 6).
 */
export class TauriOcrAdapter implements OcrPort {
  async recognize(image: Screenshot, languages?: readonly string[]): Promise<OcrText> {
    const request: OcrRequestDto = {
      imageBase64: image.imageBase64,
      ...(languages ? { languages } : {}),
    };
    const res = await invoke<OcrResultDto>(IPC_COMMANDS.ocrImage, { request });
    return {
      fullText: res.fullText,
      boxes: res.boxes.map((b) => ({ text: b.text, confidence: b.confidence })),
    };
  }
}
