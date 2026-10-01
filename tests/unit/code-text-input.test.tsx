import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeTextInput } from '@/ui/components/CodeTextInput';

describe('CodeTextInput (R15)', () => {
  it('hides the textarea until toggled, then edits through onChange', async () => {
    const onChange = vi.fn();
    render(<CodeTextInput value="" onChange={onChange} />);
    expect(screen.queryByLabelText('Код текстом')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Код текстом/ }));
    await userEvent.type(screen.getByLabelText('Код текстом'), 'x');

    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('shows the staged line count and clears it', async () => {
    const onChange = vi.fn();
    render(<CodeTextInput value={'a\nb\nc\n'} onChange={onChange} />);
    expect(screen.getByText('Код: 3 строк')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Очистить код' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
