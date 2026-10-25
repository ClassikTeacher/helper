import type { OcrPort } from '@/core/application/ports/ocr.port';
import type { AgentId } from '@/core/domain/agent';
import type { Screenshot } from '@/core/domain/screenshot';
import type { ScreenReader } from './screen-transcriber';

/**
 * The "code as text" pass on the on-device OCR (phase 6): each screenshot goes
 * through `OcrPort` (PP-OCR in native), the texts are joined in capture order.
 * Free and without an extra model call — the alternative to the cloud
 * `ScreenTranscriber`. The agent gets the result as a machine transcription
 * NEXT TO the screenshots, which stay authoritative (OCR misreads characters
 * and drops lone glyphs; the prompt tells the model the screenshots win).
 */
export class LocalScreenReader implements ScreenReader {
  constructor(
    private readonly ocr: OcrPort,
    private readonly agents: ReadonlySet<AgentId>,
  ) {}

  appliesTo(agentId: AgentId): boolean {
    return this.agents.has(agentId);
  }

  async transcribe(shots: readonly Screenshot[], signal?: AbortSignal): Promise<string> {
    const texts: string[] = [];
    // One at a time: native runs one OCR at a time anyway.
    for (const [i, shot] of shots.entries()) {
      if (signal?.aborted) return '';
      const text = (await this.ocr.recognize(shot)).fullText.trimEnd();
      if (!text.trim()) continue;
      // Several shots are consecutive views of one listing: mark the seams.
      texts.push(shots.length > 1 ? `[screenshot ${i + 1}]\n${text}` : text);
    }
    return signal?.aborted ? '' : texts.join('\n\n');
  }
}
