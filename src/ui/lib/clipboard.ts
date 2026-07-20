/**
 * Copy text to the clipboard from Figma's sandboxed plugin iframe.
 *
 * `navigator.clipboard` is frequently UNDEFINED inside that iframe (the async
 * Clipboard API isn't granted to the sandbox), so a plain
 * `navigator.clipboard.writeText(...)` throws a TypeError SYNCHRONOUSLY on the
 * `.writeText` access — which silently aborted the whole copy handler: no
 * clipboard write, and the lines after it (the toast + the ⋮ checkmark flash)
 * never ran. The reliable path inside the sandbox is the legacy
 * `document.execCommand("copy")` over a temporary, off-screen textarea,
 * executed synchronously within the click gesture. We try that first and fall
 * back to the async API only when it actually exists.
 *
 * Returns whether the copy is believed to have succeeded.
 */
export function copyToClipboard(text: string): boolean {
  // Primary: execCommand over a throwaway textarea. Works inside the sandbox
  // as long as we're still in the user-gesture task (a menu item click).
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // Keep it out of view and out of layout flow so it never flashes.
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    // Preserve any selection we're about to clobber, so copying a key doesn't
    // wipe out text the user had highlighted elsewhere.
    const selection = document.getSelection();
    const savedRange =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    if (ok) return true;
  } catch {
    // fall through to the async API
  }

  // Fallback: the async Clipboard API, guarded so an undefined `clipboard`
  // (the exact sandbox case above) can't throw synchronously.
  try {
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      void clip.writeText(text);
      return true;
    }
  } catch {
    // ignore — reported as a failure below
  }

  return false;
}
