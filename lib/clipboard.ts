/**
 * Copy text from a content script. The async Clipboard API needs a secure
 * context and a focused document, which plain-http pages do not provide, so
 * fall back to a hidden textarea + `execCommand('copy')` there.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy path.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) {
      throw new Error('execCommand("copy") was rejected');
    }
  } finally {
    textarea.remove();
  }
}
