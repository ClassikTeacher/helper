import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '@/ui/components/SettingsPanel';
import type { ComponentProps } from 'react';

type Props = ComponentProps<typeof SettingsPanel>;

/** All-callbacks-mocked defaults; each test overrides what it exercises. */
function props(overrides: Partial<Props> = {}): Props {
  return {
    hasKey: false,
    status: 'idle',
    error: null,
    onSave: vi.fn(),
    onClear: vi.fn(),
    onCopyDiagnostics: vi.fn(),
    diagnosticsStatus: 'idle',
    ...overrides,
  };
}

describe('SettingsPanel', () => {
  it('submits the trimmed input value and clears the field', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel {...props({ onSave })} />);

    const input = screen.getByPlaceholderText(/sk-or-v1/i);
    await user.type(input, '  sk-or-v1-example  ');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('sk-or-v1-example');
    expect(input).toHaveValue('');
  });

  it('does not submit an empty/whitespace-only value', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel {...props({ onSave })} />);

    await user.type(screen.getByPlaceholderText(/sk-or-v1/i), '   ');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the configured status without ever displaying the key value', () => {
    render(<SettingsPanel {...props({ hasKey: true })} />);
    expect(screen.getByText(/key configured/i)).toBeInTheDocument();
  });

  it('offers "Remove key" only when a key is configured, and calls onClear', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SettingsPanel {...props({ onClear })} />);
    expect(screen.queryByRole('button', { name: /remove key/i })).not.toBeInTheDocument();

    rerender(<SettingsPanel {...props({ hasKey: true, onClear })} />);
    await user.click(screen.getByRole('button', { name: /remove key/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('surfaces a save error', () => {
    render(<SettingsPanel {...props({ status: 'error', error: 'keychain write failed' })} />);
    expect(screen.getByText(/failed: keychain write failed/i)).toBeInTheDocument();
  });

  it('"Copy diagnostics" calls onCopyDiagnostics and reflects the copy status', async () => {
    const onCopyDiagnostics = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SettingsPanel {...props({ onCopyDiagnostics })} />);

    await user.click(screen.getByRole('button', { name: /copy diagnostics/i }));
    expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);

    rerender(<SettingsPanel {...props({ onCopyDiagnostics, diagnosticsStatus: 'copying' })} />);
    expect(screen.getByRole('button', { name: /copying/i })).toBeDisabled();

    rerender(<SettingsPanel {...props({ onCopyDiagnostics, diagnosticsStatus: 'copied' })} />);
    expect(screen.getByRole('button', { name: /copied/i })).toBeEnabled();

    rerender(<SettingsPanel {...props({ onCopyDiagnostics, diagnosticsStatus: 'error' })} />);
    expect(screen.getByRole('button', { name: /copy failed/i })).toBeEnabled();
  });
});
