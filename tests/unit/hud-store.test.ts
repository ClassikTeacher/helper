import { describe, it, expect, beforeEach } from 'vitest';
import { useHudStore, MAX_SCREENSHOTS } from '@/ui/store/hud.store';
import type { Screenshot } from '@/core/domain/screenshot';

function shot(tag: string, capturedAt = 0): Screenshot {
  return { imageBase64: tag, width: 1, height: 1, capturedAt };
}

beforeEach(() => {
  useHudStore.setState({ screenshots: [], error: null, answer: '', streaming: false, activeHint: '' });
});

describe('hud.store screenshot batch (phase 8)', () => {
  it('appends screenshots in order', () => {
    const { addScreenshot } = useHudStore.getState();
    addScreenshot(shot('a'));
    addScreenshot(shot('b'));

    expect(useHudStore.getState().screenshots.map((s) => s.imageBase64)).toEqual(['a', 'b']);
  });

  it('ignores captures past MAX_SCREENSHOTS instead of dropping the oldest', () => {
    const { addScreenshot } = useHudStore.getState();
    for (let i = 0; i < MAX_SCREENSHOTS + 3; i++) addScreenshot(shot(String(i), i));

    const kept = useHudStore.getState().screenshots;
    expect(kept).toHaveLength(MAX_SCREENSHOTS);
    // The FIRST MAX_SCREENSHOTS are kept (overflow ignored, not FIFO-evicted).
    expect(kept.map((s) => s.imageBase64)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('clears the error when a screenshot is added', () => {
    useHudStore.setState({ error: 'boom' });
    useHudStore.getState().addScreenshot(shot('a'));

    expect(useHudStore.getState().error).toBeNull();
  });

  it('removes the screenshot at the given index', () => {
    const { addScreenshot, removeScreenshot } = useHudStore.getState();
    addScreenshot(shot('a'));
    addScreenshot(shot('b'));
    addScreenshot(shot('c'));

    removeScreenshot(1);

    expect(useHudStore.getState().screenshots.map((s) => s.imageBase64)).toEqual(['a', 'c']);
  });

  it('clears the whole batch', () => {
    const { addScreenshot, clearScreenshots } = useHudStore.getState();
    addScreenshot(shot('a'));
    addScreenshot(shot('b'));

    clearScreenshots();

    expect(useHudStore.getState().screenshots).toEqual([]);
  });

  it('reset empties the batch', () => {
    useHudStore.getState().addScreenshot(shot('a'));
    useHudStore.getState().reset();

    expect(useHudStore.getState().screenshots).toEqual([]);
  });
});

describe('hud.store audio recording (phase 9)', () => {
  it('setRecording toggles the recording flag', () => {
    useHudStore.getState().setRecording(true);
    expect(useHudStore.getState().recording).toBe(true);
    useHudStore.getState().setRecording(false);
    expect(useHudStore.getState().recording).toBe(false);
  });

  it('startTranscribing stops recording, shows the spinner, and clears prior transcript/error', () => {
    useHudStore.setState({ recording: true, transcript: 'old', error: 'boom' });
    useHudStore.getState().startTranscribing();

    const s = useHudStore.getState();
    expect(s.recording).toBe(false);
    expect(s.transcribing).toBe(true);
    expect(s.transcript).toBe('');
    expect(s.error).toBeNull();
  });

  it('setTranscript stores the text and clears the transcribing spinner', () => {
    useHudStore.setState({ transcribing: true });
    useHudStore.getState().setTranscript('привет');

    expect(useHudStore.getState().transcript).toBe('привет');
    expect(useHudStore.getState().transcribing).toBe(false);
  });

  it('fail clears the recording + transcribing indicators (a failed STT must not leave them on)', () => {
    useHudStore.setState({ recording: true, transcribing: true });
    useHudStore.getState().fail('stt exploded');

    const s = useHudStore.getState();
    expect(s.recording).toBe(false);
    expect(s.transcribing).toBe(false);
    expect(s.error).toBe('stt exploded');
  });

  it('reset clears recording/transcribing/transcript', () => {
    useHudStore.setState({ recording: true, transcribing: true, transcript: 'x' });
    useHudStore.getState().reset();

    const s = useHudStore.getState();
    expect(s.recording).toBe(false);
    expect(s.transcribing).toBe(false);
    expect(s.transcript).toBe('');
  });
});

describe('hud.store code text + run info (R15, R9/R19)', () => {
  it('stores the staged code text and reset clears it', () => {
    useHudStore.getState().setCodeText('x := 1');
    expect(useHudStore.getState().codeText).toBe('x := 1');

    useHudStore.getState().reset();
    expect(useHudStore.getState().codeText).toBe('');
  });

  it('startStreaming clears the previous run info; setLastRun stores the new one', () => {
    useHudStore.getState().setLastRun({ model: 'm', fallback: false, reason: 'stop' });
    useHudStore.getState().startStreaming();
    expect(useHudStore.getState().lastRun).toBeNull();

    useHudStore.getState().setLastRun({ model: 'b', fallback: true, reason: 'length', cost: 0.01 });
    expect(useHudStore.getState().lastRun).toEqual({
      model: 'b',
      fallback: true,
      reason: 'length',
      cost: 0.01,
    });
  });
});
