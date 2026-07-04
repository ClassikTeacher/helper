import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageSelect } from '@/ui/components/LanguageSelect';
import { LANGUAGE_OPTIONS } from '@/core/domain/language';

describe('LanguageSelect', () => {
  it('renders all languages in the intended order', () => {
    render(<LanguageSelect value="all" onChange={vi.fn()} />);

    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(LANGUAGE_OPTIONS.map((o) => o.value));
    // The product-specified order: all, JS, TS, Go, Python, SQL, C#, Java, Kotlin, Swift.
    expect(options.map((o) => o.value)).toEqual([
      'all',
      'js',
      'ts',
      'go',
      'python',
      'sql',
      'csharp',
      'java',
      'kotlin',
      'swift',
    ]);
  });

  it('reflects the selected value', () => {
    render(<LanguageSelect value="python" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('python');
  });

  it('emits the chosen language on change', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<LanguageSelect value="all" onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox'), 'go');

    expect(onChange).toHaveBeenCalledWith('go');
  });
});
