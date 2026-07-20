/**
 * Copy text to the clipboard from Figma's sandboxed plugin iframe.
 *
 * Two sandbox quirks make this harder than it looks:
 *  1. `navigator.clipboard` is frequently UNDEFINED (the async Clipboard API
 *     isn't granted), so `navigator.clipboard.writeText(...)` throws a
 *     TypeError SYNCHRONOUSLY on the `.writeText` access.
 *  2. `document.execCommand("copy")` often returns `true` WITHOUT actually
 *     writing — the checkmark flashes but the real clipboard keeps its old
 *     contents (observed on Figma desktop / macOS).
 *
 * So we don't trust either. We register a one-shot `copy` event listener and
 * write the text into `clipboardData` OURSELVES, then trigger the event with a
 * selected off-screen textarea. Success is defined as "our copy handler
 * actually fired", not execCommand's return value. The async Clipboard API is
 * only a last-resort fallback for environments that expose it.
 *
 * Must be called synchronously from a user gesture (a menu-item click).
 * Returns whether the copy is believed to have succeeded.
 */
export function copyToClipboard(text: string): boolean {
  let copied = false;

  const onCopy = (event: Event): void => {
    const e = event as ClipboardEvent;
    // Set the payload ourselves so it doesn't depend on the textarea selection
    // being copyable — this is what makes the write actually land.
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
    copied = true;
  };

  try {
    // Capture phase so we see the event before anything else can stop it.
    document.addEventListener("copy", onCopy, true);

    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Off-screen but still selectable — NOT display:none / visibility:hidden
    // and NOT readonly, both of which can suppress the copy event.
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.padding = "0";
    textarea.style.border = "none";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    // Preserve any selection we're about to clobber, so copying a key doesn't
    // wipe out text the user had highlighted elsewhere.
    const selection = document.getSelection();
    const savedRange =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.focus();
    textarea.select();
    // Fires the `copy` event (→ onCopy writes the data). Its boolean is
    // deliberately ignored; `copied` is the source of truth.
    document.execCommand("copy");
    document.body.removeChild(textarea);

    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
  } catch {
    // fall through to the async fallback
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }

  if (copied) return true;

  // Last resort: the async Clipboard API when the environment exposes it
  // (never the pure Figma sandbox, but harmless elsewhere). Guarded so an
  // undefined `clipboard` can't throw synchronously.
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
