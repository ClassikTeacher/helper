import { describe, it, expect } from 'vitest';
import { buildAgentPrompt, summarizeInvocation } from '@/core/application/services/agent-prompt';
import { AGENTS } from '@/core/domain/agents-catalog';

describe('buildAgentPrompt', () => {
  it('uses the agent system prompt verbatim as the system text', () => {
    const { system } = buildAgentPrompt({ agent: AGENTS.solver, language: 'all', instructions: '' });
    expect(system).toBe(AGENTS.solver.systemPrompt);
  });

  it('tells the model to infer the language when the solver language is "all"', () => {
    const { userText } = buildAgentPrompt({ agent: AGENTS.solver, language: 'all', instructions: '' });
    expect(userText).toMatch(/infer .* from the screenshot/);
  });

  it('states the target language label when the solver has a concrete language', () => {
    const { userText } = buildAgentPrompt({ agent: AGENTS.solver, language: 'go', instructions: '' });
    expect(userText).toContain('Target programming language: Go');
  });

  it('includes the user instructions when present', () => {
    const { userText } = buildAgentPrompt({
      agent: AGENTS.solver,
      language: 'all',
      instructions: '  use React  ',
    });
    expect(userText).toContain('Additional user instructions: use React');
  });

  it('omits the instructions line when instructions are blank', () => {
    const { userText } = buildAgentPrompt({ agent: AGENTS.solver, language: 'all', instructions: '   ' });
    expect(userText).not.toContain('Additional user instructions');
  });

  it('always instructs the model to answer in Russian (MVP: answer language is fixed)', () => {
    const solver = buildAgentPrompt({ agent: AGENTS.solver, language: 'all', instructions: '' });
    const reviewer = buildAgentPrompt({ agent: AGENTS.reviewer, language: 'all', instructions: '' });
    expect(solver.userText).toContain('Write your answer in Russian');
    expect(reviewer.userText).toContain('Write your answer in Russian');
  });

  it('never adds a language line for the reviewer (language is inferred from syntax)', () => {
    // The reviewer's requiresLanguage is false: even if a language is passed,
    // no language directive should appear — it would only add room for error.
    const { userText } = buildAgentPrompt({ agent: AGENTS.reviewer, language: 'python', instructions: '' });
    expect(userText).not.toContain('programming language');
    expect(userText).not.toContain('Python');
  });
});

describe('summarizeInvocation', () => {
  it('summarizes the solver with language and instructions', () => {
    expect(
      summarizeInvocation({ agent: AGENTS.solver, language: 'ts', instructions: 'no deps' }),
    ).toBe('Solve (TypeScript) — no deps');
  });

  it('drops the language when unspecified', () => {
    expect(summarizeInvocation({ agent: AGENTS.solver, language: 'all', instructions: '' })).toBe(
      'Solve',
    );
  });

  it('never shows a language for the reviewer', () => {
    expect(
      summarizeInvocation({ agent: AGENTS.reviewer, language: 'java', instructions: '' }),
    ).toBe('Review');
  });
});
