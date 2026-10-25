import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '@/ui/components/SettingsPanel';
import type { SettingsForm } from '@/ui/hooks/useSettings';
import type { ComponentProps } from 'react';
import { BASE } from './settings.domain.test';

type Props = ComponentProps<typeof SettingsPanel>;

function fakeForm(overrides: Partial<SettingsForm> = {}): SettingsForm {
  return {
    settings: BASE,
    defaults: BASE,
    draft: BASE,
    dirty: false,
    errors: {},
    status: 'idle',
    error: null,
    update: vi.fn(),
    save: vi.fn(async () => {}),
    discard: vi.fn(),
    reset: vi.fn(async () => {}),
    ...overrides,
  };
}

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
    form: fakeForm(),
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

  it('the Хоткеи tab edits the draft through form.update and saves only when dirty and valid (F2)', async () => {
    const update = vi.fn();
    const save = vi.fn(async () => {});
    const user = userEvent.setup();
    const { rerender } = render(<SettingsPanel {...props({ form: fakeForm({ update, save }) })} />);

    await user.click(screen.getByRole('tab', { name: 'Хоткеи' }));
    const field = screen.getByLabelText(/скриншот монитора/i);
    expect(field).toHaveValue(BASE.hotkeys.capture);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await user.type(field, '1');
    expect(update).toHaveBeenLastCalledWith({ hotkeys: { capture: `${BASE.hotkeys.capture}1` } });

    rerender(<SettingsPanel {...props({ form: fakeForm({ update, save, dirty: true }) })} />);
    await user.click(screen.getByRole('tab', { name: 'Хоткеи' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(save).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsPanel
        {...props({ form: fakeForm({ update, save, dirty: true, errors: { 'hotkeys.capture': 'Нужен модификатор' } }) })}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Хоткеи' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Нужен модификатор');
  });

  it('the Приватность tab toggles the provider policy; "Сбросить" calls form.reset', async () => {
    const update = vi.fn();
    const reset = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<SettingsPanel {...props({ form: fakeForm({ update, reset }) })} />);

    await user.click(screen.getByRole('tab', { name: 'Приватность' }));
    await user.selectOptions(screen.getByLabelText(/provider\.data_collection/i), 'allow');
    expect(update).toHaveBeenCalledWith({ provider: { dataCollection: 'allow' } });
    await user.click(screen.getByLabelText(/требовать ZDR/i));
    expect(update).toHaveBeenCalledWith({ provider: { zdr: true } });

    await user.click(screen.getByRole('button', { name: /сбросить/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
