import type {
  AgentRunner,
  AnalyzeScreenParams,
  AskParams,
} from '@/core/application/services/agent-runner';

/**
 * Use-case: analyze the current screen with a prompt and stream the answer.
 * Thin wrapper over AgentRunner — the seam the UI calls through DI.
 */
export class AnalyzeScreenshotUseCase {
  constructor(private readonly runner: AgentRunner) {}

  execute(params: AnalyzeScreenParams): AsyncIterable<string> {
    return this.runner.analyzeScreen(params);
  }

  /** A typed message with nothing attached — a follow-up or a standalone question. */
  ask(params: AskParams): AsyncIterable<string> {
    return this.runner.ask(params);
  }
}
