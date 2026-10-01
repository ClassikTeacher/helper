import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { highlightTokens, resolveLanguage } from '@/ui/components/code/highlighter';
import { CodeBlock } from '@/ui/components/code/CodeBlock';
import { MarkdownMessage } from '@/ui/components/MarkdownMessage';

const SAMPLES: Record<string, string> = {
  go: 'func main() { fmt.Println("hi") }',
  python: 'def f(x):\n    return x * 2',
  javascript: 'const x = (a) => a + 1;',
  typescript: 'const x: number = 1;',
  jsx: 'const a = <div className="x">{y}</div>;',
  tsx: 'const a: JSX.Element = <div />;',
  sql: 'SELECT id FROM users WHERE id = 1;',
  csharp: 'public class A { int X => 1; }',
  java: 'class A { void f() {} }',
  kotlin: 'fun main() = println("hi")',
  swift: 'let x: Int = 1',
  rust: 'fn main() { let x = 1; }',
  cpp: 'int main() { return 0; }',
  c: 'int main(void) { return 0; }',
  bash: 'echo "$HOME" | grep x',
  json: '{"a": [1, 2]}',
  yaml: 'a:\n  - b: 1',
};

describe('highlighter (task 11)', () => {
  it.each(Object.entries(SAMPLES))(
    '%s compiles on the JS regex engine (no WASM) and colors tokens',
    async (lang, code) => {
      const tokens = await highlightTokens(code, lang);
      expect(tokens).not.toBeNull();
      const colors = new Set(tokens!.flat().map((t) => t.color));
      expect(colors.size).toBeGreaterThan(1);
      // Round-trip: the tokens reproduce the code exactly.
      expect(tokens!.map((line) => line.map((t) => t.content).join('')).join('\n')).toBe(code);
    },
    20_000,
  );

  it('resolves common fence aliases and rejects unknown languages', () => {
    expect(resolveLanguage('golang')).toBe('go');
    expect(resolveLanguage('TS')).toBe('typescript');
    expect(resolveLanguage('c#')).toBe('csharp');
    expect(resolveLanguage('brainfuck')).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });

  it('returns null (plain text) for an unsupported language', async () => {
    expect(await highlightTokens('x', 'cobol')).toBeNull();
  });
});

describe('CodeBlock', () => {
  it('shows the code immediately, then the highlighted version', async () => {
    const { container } = render(<CodeBlock code={'x := 1'} lang="go" />);
    expect(container.querySelector('code')).toHaveTextContent('x := 1');
    await waitFor(() => expect(container.querySelector('code')).toHaveAttribute('data-highlighted', 'true'), {
      timeout: 5000,
    });
    expect(container.querySelector('code')).toHaveTextContent('x := 1');
  });

  it('copies the exact code', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<CodeBlock code={'SELECT 1;'} lang="sql" />);

    await user.click(screen.getByRole('button', { name: 'Скопировать код' }));

    expect(writeText).toHaveBeenCalledWith('SELECT 1;');
    expect(await screen.findByText('✓ скопировано')).toBeInTheDocument();
  });
});

describe('MarkdownMessage', () => {
  it('renders fenced blocks as CodeBlock and keeps inline code inline', () => {
    render(<MarkdownMessage content={'Use `len(s)` here:\n\n```go\nfmt.Println(1)\n```\n'} />);
    expect(screen.getByRole('button', { name: 'Скопировать код' })).toBeInTheDocument();
    expect(screen.getByText('len(s)').tagName).toBe('CODE');
    expect(screen.getByText('go')).toBeInTheDocument();
  });

  it('never renders raw HTML from the model', () => {
    const { container } = render(<MarkdownMessage content={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
