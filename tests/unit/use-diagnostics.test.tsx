import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiagnostics } from '@/ui/hooks/useDiagnostics';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { createContainer } from '@/bootstrap/container';
import { FakeDiagnosticsAdapter } from '@/infrastructure/mocks/fake-diagnostics.adapter';
import type { DiagnosticsPort } from '@/core/application/ports/diagnostics.port';
import type { PropsWithChildren } from 'react';

function wrapperWith(diagnostics: DiagnosticsPort) {
  const container = createContainer({ diagnostics });
  return function Wrapper({ children }: PropsWithChildren) {
    return <ServicesProvider container={container}>{children}</ServicesProvider>;
  };
}

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('useDiagnostics', () => {
  it('copy() puts the formatted diagnostics text on the clipboard and reports "copied"', async () => {
    writeText.mockResolvedValue(undefined);
    const diagnostics = new FakeDiagnosticsAdapter({
      appVersion: '1.2.3',
      os: 'windows',
      arch: 'x86_64',
      logPath: 'C:\\logs\\ai-helper.log',
      logTail: '[INFO] started\n',
    });
    const { result } = renderHook(() => useDiagnostics(), { wrapper: wrapperWith(diagnostics) });
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.copy();
    });

    expect(result.current.status).toBe('copied');
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]?.[0] ?? '';
    expect(text.startsWith('AI-Helper diagnostics\nversion: 1.2.3 · platform: windows/x86_64')).toBe(true);
    expect(text).toContain('log: C:\\logs\\ai-helper.log');
    expect(text).toContain('[INFO] started');
  });

  it('reports "error" when the snapshot cannot be fetched, without throwing', async () => {
    const failing: DiagnosticsPort = {
      snapshot: async () => {
        throw new Error('native unavailable');
      },
    };
    const { result } = renderHook(() => useDiagnostics(), { wrapper: wrapperWith(failing) });

    await act(async () => {
      await result.current.copy();
    });

    expect(result.current.status).toBe('error');
    expect(writeText).not.toHaveBeenCalled();
  });
});
