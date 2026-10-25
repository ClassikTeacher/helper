import type { SettingsPort } from '@/core/application/ports/settings.port';
import type { SettingsDocument } from '@/core/domain/settings';

/**
 * SettingsPort for the browser (`pnpm dev`) and tests: the document lives in
 * memory for the page's lifetime. `document` is readable so tests can assert
 * exactly what would have been written.
 */
export class InMemorySettingsAdapter implements SettingsPort {
  document: unknown;

  constructor(initial: unknown = null) {
    this.document = initial;
  }

  async load(): Promise<unknown> {
    return this.document;
  }

  async save(document: SettingsDocument): Promise<void> {
    this.document = structuredClone(document);
  }
}
