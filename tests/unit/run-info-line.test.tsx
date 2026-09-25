import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunInfoLine } from '@/ui/components/RunInfoLine';

describe('RunInfoLine (R9/R19)', () => {
  it('renders nothing before any run', () => {
    const { container } = render(<RunInfoLine info={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the serving model, tokens and cost', () => {
    render(
      <RunInfoLine
        info={{
          model: 'anthropic/claude-haiku-4.5',
          fallback: false,
          reason: 'stop',
          inputTokens: 1234,
          outputTokens: 567,
          cost: 0.0021,
        }}
      />,
    );
    expect(
      screen.getByText('anthropic/claude-haiku-4.5 · 1234→567 tok · $0.0021'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('flags an answer that came from a fallback model', () => {
    render(<RunInfoLine info={{ model: 'openai/gpt-4o-mini', fallback: true, reason: 'stop' }} />);
    expect(screen.getByText(/резервная модель · openai\/gpt-4o-mini/)).toBeInTheDocument();
  });

  it('warns when the provider cut the answer by length', () => {
    render(<RunInfoLine info={{ fallback: false, reason: 'length' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Ответ обрезан');
  });
});
