import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioControls } from '@/ui/components/AudioControls';

const base = { transcribing: false, transcript: '', onToggle: () => {} };

describe('AudioControls recording clock (P0)', () => {
  it('shows the elapsed time while recording', () => {
    render(<AudioControls {...base} recording elapsedSecs={42} windowSecs={60} />);
    expect(screen.getByText(/запись 0:42/)).toBeInTheDocument();
    expect(screen.queryByText(/последние/)).not.toBeInTheDocument();
  });

  it('says only the last N seconds will be sent once the window rolls', () => {
    render(<AudioControls {...base} recording elapsedSecs={75} windowSecs={60} />);
    expect(screen.getByText(/запись 1:15/)).toBeInTheDocument();
    expect(screen.getByText(/в запрос уйдут последние 60 с/)).toBeInTheDocument();
  });
});
