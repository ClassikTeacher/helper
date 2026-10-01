import type {
  AgentRunner,
  AnalyzeScreenParams,
  FollowUpParams,
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

  /** A follow-up question on the current thread (P1 item 9). */
  followUp(params: FollowUpParams): AsyncIterable<string> {
    return this.runner.followUp(params);
  }
}
