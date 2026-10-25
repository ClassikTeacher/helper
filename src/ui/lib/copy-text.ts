/**
 * Copies `text` to the clipboard from a user gesture: the Clipboard API first,
 * with a hidden-textarea `execCommand` fallback for webviews that deny it.
 * Shared by the code-block copy button and "Copy diagnostics" in settings.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: a hidden textarea + execCommand (deprecated, still supported).
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
