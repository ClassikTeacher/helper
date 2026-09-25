import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '@/ui/components/MessageList';

describe('MessageList', () => {
  it('shows a placeholder when there is nothing to show yet', () => {
    render(<MessageList answer="" streaming={false} error={null} />);
    expect(screen.getByText(/press the hotkey or ask something/i)).toBeInTheDocument();
  });

  it('shows a bare error when the stream failed before any output arrived', () => {
    render(<MessageList answer="" streaming={false} error="OpenRouter API key is not set." />);
    expect(screen.getByText(/^Error: OpenRouter API key is not set\.$/)).toBeInTheDocument();
  });

  it('keeps the partial answer visible alongside the error instead of discarding it', () => {
    // Regression test for the terminal `error` chunk contract (architecture.md
    // §11): a `finish`-or-`error` chunk can arrive after real `text-delta`
    // output already streamed in, and that partial answer must stay on screen.
    render(<MessageList answer="Here is what I " streaming={false} error="connection reset" />);
    expect(screen.getByText(/here is what i/i)).toBeInTheDocument();
    expect(screen.getByText(/^Interrupted: connection reset$/)).toBeInTheDocument();
  });

  it('shows the streaming caret while an answer is still coming in, without an error', () => {
    const { container } = render(<MessageList answer="partial" streaming={true} error={null} />);
    expect(screen.getByText(/partial/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});

describe('MessageList stop note (P0)', () => {
  it('shows "Остановлено." under a stopped partial answer', () => {
    render(<MessageList answer="partial" streaming={false} error={null} stopped />);
    expect(screen.getByText('Остановлено.')).toBeInTheDocument();
  });
});
