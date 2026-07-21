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
