import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
}));

import { error as logError, warn as logWarn } from '@tauri-apps/plugin-log';
import { installLogForwarding, describe as describeArg } from '@/bootstrap/install-log-forwarding';

const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
  vi.mocked(logError).mockClear();
  vi.mocked(logWarn).mockClear();
  console.error = vi.fn();
  console.warn = vi.fn();
});

afterEach(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

describe('installLogForwarding', () => {
  it('keeps console.error/warn working and mirrors them to the native log as one line', () => {
    const consoleError = console.error;
    const consoleWarn = console.warn;
    installLogForwarding();

    console.error('hotkey failed', new Error('registration denied'), { code: 7 });
    console.warn('slow', 1234);

    expect(consoleError).toHaveBeenCalledWith('hotkey failed', expect.any(Error), { code: 7 });
    expect(logError).toHaveBeenCalledWith('hotkey failed Error: registration denied {"code":7}');
    expect(consoleWarn).toHaveBeenCalledWith('slow', 1234);
    expect(logWarn).toHaveBeenCalledWith('slow 1234');
  });

  it('never lets a failing log sink surface as an app error', async () => {
    vi.mocked(logError).mockRejectedValueOnce(new Error('ipc down'));
    installLogForwarding();
    expect(() => console.error('boom')).not.toThrow();
    await Promise.resolve();
  });

  it('forwards uncaught errors and unhandled rejections', () => {
    installLogForwarding();
    window.dispatchEvent(new ErrorEvent('error', { message: 'x is undefined', filename: 'app.js', lineno: 12 }));
    expect(logError).toHaveBeenCalledWith('uncaught: x is undefined (app.js:12)');

    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('late failure');
    window.dispatchEvent(rejection);
    expect(logError).toHaveBeenCalledWith('unhandled rejection: Error: late failure');
  });
});

describe('describe', () => {
  it('renders errors, strings and objects on one line', () => {
    expect(describeArg(new TypeError('bad'))).toBe('TypeError: bad');
    expect(describeArg('plain')).toBe('plain');
    expect(describeArg({ a: 1 })).toBe('{"a":1}');
    expect(describeArg(undefined)).toBe('undefined');
  });
});
