import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptInput } from '@/ui/components/PromptInput';

describe('PromptInput', () => {
  it('keeps the newlines of a pasted multi-line snippet', () => {
    // The box doubles as the code input for a screenshot-free send; a
    // single-line field would flatten the paste and destroy the code's shape.
    const onChange = vi.fn();
    render(<PromptInput value="" onChange={onChange} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'func main() {\n\tprintln(1)\n}' },
    });

    expect(onChange).toHaveBeenCalledWith('func main() {\n\tprintln(1)\n}');
  });

  it('submits on Enter and inserts a newline on Shift+Enter', () => {
    const onSubmit = vi.fn();
    render(<PromptInput value="code" onChange={vi.fn()} onSubmit={onSubmit} />);
    const box = screen.getByRole('textbox');

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit while disabled', () => {
    const onSubmit = vi.fn();
    render(<PromptInput value="code" disabled onChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
