import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSettings } from '@/ui/hooks/useSettings';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { createContainer } from '@/bootstrap/container';
import { InMemorySettingsAdapter } from '@/infrastructure/mocks/in-memory-settings.adapter';
import type { PropsWithChildren } from 'react';
import { BASE } from './settings.domain.test';

function setup(adapter = new InMemorySettingsAdapter(null)) {
  const container = createContainer({ settings: adapter, defaultSettings: BASE });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ServicesProvider container={container}>{children}</ServicesProvider>
  );
  return { container, adapter, ...renderHook(() => useSettings(), { wrapper }) };
}

describe('useSettings (F2)', () => {
  it('starts from the effective settings with a clean draft', () => {
    const { result } = setup();
    expect(result.current.draft).toEqual(BASE);
    expect(result.current.dirty).toBe(false);
    expect(result.current.errors).toEqual({});
  });

  it('update edits the draft, validates live, and save persists only the diff', async () => {
    const { result, adapter } = setup();

    act(() => result.current.update({ hotkeys: { capture: 'Shift+K' } }));
    expect(result.current.dirty).toBe(true);
    expect(result.current.errors['hotkeys.capture']).toBeDefined();

    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('error');
    expect(adapter.document).toBeNull();

    act(() => result.current.update({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+1' } }));
    expect(result.current.errors).toEqual({});
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('saved');
    expect(result.current.dirty).toBe(false);
    expect(adapter.document).toEqual({ schemaVersion: 1, hotkeys: { capture: 'CommandOrControl+Alt+Shift+1' } });
    expect(result.current.settings.hotkeys.capture).toBe('CommandOrControl+Alt+Shift+1');
  });

  it('discard drops the draft; reset returns to the defaults', async () => {
    const { result, adapter } = setup();
    act(() => result.current.update({ recording: { windowSecs: 30 } }));
    act(() => result.current.discard());
    expect(result.current.draft).toEqual(BASE);
    expect(result.current.dirty).toBe(false);

    await act(async () => {
      await result.current.save();
    });
    act(() => result.current.update({ recording: { windowSecs: 45 } }));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.settings.recording.windowSecs).toBe(45);

    await act(async () => {
      await result.current.reset();
    });
    await waitFor(() => expect(result.current.draft.recording.windowSecs).toBe(60));
    expect(adapter.document).toEqual({ schemaVersion: 1 });
  });
});
