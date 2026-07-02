import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '@/ui/components/SettingsPanel';

describe('SettingsPanel', () => {
  it('submits the trimmed input value and clears the field', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel hasKey={false} status="idle" error={null} onSave={onSave} />);

    const input = screen.getByPlaceholderText(/sk-or-v1/i);
    await user.type(input, '  sk-or-v1-example  ');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-or-v1-example');
    expect(input).toHaveValue('');
  });

  it('does not submit an empty/whitespace-only value', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel hasKey={false} status="idle" error={null} onSave={onSave} />);

    await user.type(screen.getByPlaceholderText(/sk-or-v1/i), '   ');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the configured status without ever displaying the key value', () => {
    render(<SettingsPanel hasKey={true} status="idle" error={null} onSave={vi.fn()} />);
    expect(screen.getByText(/key configured/i)).toBeInTheDocument();
  });

  it('surfaces a save error', () => {
    render(<SettingsPanel hasKey={false} status="error" error="keychain write failed" onSave={vi.fn()} />);
    expect(screen.getByText(/failed to save: keychain write failed/i)).toBeInTheDocument();
  });
});
