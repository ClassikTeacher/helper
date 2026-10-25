import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownMessage } from '@/ui/components/MarkdownMessage';

/**
 * Model output is untrusted (architecture.md §11). A link in an answer must
 * never be able to navigate the HUD webview away (2026-10 review §2.5), and raw
 * HTML must stay inert.
 */
describe('MarkdownMessage — untrusted output', () => {
  it('renders markdown links as plain text with the URL, never as an anchor', () => {
    const { container } = render(
      <MarkdownMessage content={'See [the docs](https://evil.example/login) and https://auto.example/x'} />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('the docs')).toBeInTheDocument();
    expect(screen.getByText('(https://evil.example/login)')).toBeInTheDocument();
    // A GFM autolink shows its URL once, not twice.
    expect(screen.getAllByText('https://auto.example/x')).toHaveLength(1);
  });

  it('keeps raw HTML inert (no rehype-raw) and strips javascript: URLs', () => {
    const { container } = render(
      <MarkdownMessage
        content={'<img src=x onerror="alert(1)"> [x](javascript:alert(1)) <a href="https://evil.example">y</a>'}
      />,
    );

    // The HTML is escaped into visible text, never parsed into elements.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
    // react-markdown drops the unsafe protocol, so no URL is shown for it.
    expect(container.querySelector('[data-link-url]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('still renders fenced code through CodeBlock with a copy button', () => {
    render(<MarkdownMessage content={'```go\nfunc main() {}\n```'} />);
    expect(screen.getByRole('button', { name: /скопировать код/i })).toBeInTheDocument();
    expect(screen.getByText(/func main\(\) \{\}/)).toBeInTheDocument();
  });
});
