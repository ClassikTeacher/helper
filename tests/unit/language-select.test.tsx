import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageSelect } from '@/ui/components/LanguageSelect';
import { LANGUAGE_OPTIONS } from '@/core/domain/language';

describe('LanguageSelect', () => {
  it('renders all languages in the intended order once opened', async () => {
    const user = userEvent.setup();
    render(<LanguageSelect value="all" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Programming language' }));

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(LANGUAGE_OPTIONS.map((o) => o.label));
    // The product-specified order: all, JS, TS, Go, Python, SQL, C#, Java, Kotlin, Swift.
    expect(options.map((o) => o.textContent)).toEqual([
      'Auto / Any',
      'JavaScript',
      'TypeScript',
      'Go',
      'Python',
      'SQL',
      'C#',
      'Java',
      'Kotlin',
      'Swift',
    ]);
  });

  it('does not render the options list until opened (stays inside the protected window)', () => {
    render(<LanguageSelect value="all" onChange={vi.fn()} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('reflects the selected value on the trigger', () => {
    render(<LanguageSelect value="python" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Programming language' })).toHaveTextContent('Python');
  });

  it('emits the chosen language and closes the list on change', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<LanguageSelect value="all" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Programming language' }));
    await user.click(screen.getByRole('option', { name: 'Go' }));

    expect(onChange).toHaveBeenCalledWith('go');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the list on Escape', async () => {
    const user = userEvent.setup();
    render(<LanguageSelect value="all" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Programming language' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
