import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '@/ui/components/SettingsPanel';

describe('SettingsPanel', () => {
  it('submits the trimmed input value and clears the field', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel hasKey={false} status="idle" error={null} onSave={onSave} onClear={vi.fn()} />);

    const input = screen.getByPlaceholderText(/sk-or-v1/i);
    await user.type(input, '  sk-or-v1-example  ');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-or-v1-example');
    expect(input).toHaveValue('');
  });

  it('does not submit an empty/whitespace-only value', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel hasKey={false} status="idle" error={null} onSave={onSave} onClear={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/sk-or-v1/i), '   ');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the configured status without ever displaying the key value', () => {
    render(<SettingsPanel hasKey={true} status="idle" error={null} onSave={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/key configured/i)).toBeInTheDocument();
  });

  it('offers "Remove key" only when a key is configured, and calls onClear', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <SettingsPanel hasKey={false} status="idle" error={null} onSave={vi.fn()} onClear={onClear} />,
    );
    expect(screen.queryByRole('button', { name: /remove key/i })).not.toBeInTheDocument();

    rerender(<SettingsPanel hasKey={true} status="idle" error={null} onSave={vi.fn()} onClear={onClear} />);
    await user.click(screen.getByRole('button', { name: /remove key/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('surfaces a save error', () => {
    render(
      <SettingsPanel hasKey={false} status="error" error="keychain write failed" onSave={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText(/failed: keychain write failed/i)).toBeInTheDocument();
  });
});
