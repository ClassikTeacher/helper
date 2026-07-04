import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentSwitch } from '@/ui/components/AgentSwitch';
import { AGENT_LIST } from '@/core/domain/agents-catalog';

describe('AgentSwitch', () => {
  it('marks the selected agent as checked', () => {
    render(<AgentSwitch agents={AGENT_LIST} selected="reviewer" onSelect={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Review' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Solve' })).not.toBeChecked();
  });

  it('emits the chosen agent id on click', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<AgentSwitch agents={AGENT_LIST} selected="solver" onSelect={onSelect} />);

    await user.click(screen.getByRole('radio', { name: 'Review' }));

    expect(onSelect).toHaveBeenCalledWith('reviewer');
  });

  it('does not emit when disabled (e.g. mid-stream)', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<AgentSwitch agents={AGENT_LIST} selected="solver" disabled onSelect={onSelect} />);

    await user.click(screen.getByRole('radio', { name: 'Review' }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
