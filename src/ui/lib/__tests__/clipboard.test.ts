import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "$ui/lib/clipboard";

// The test env is `node` (no jsdom); `navigator` is a read-only global there,
// so we install fakes with `vi.stubGlobal` (plain assignment throws).

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fake `document` whose `execCommand` returns `execOk` (or throws). */
function installDocument(execOk: boolean | "throw") {
  const appended: unknown[] = [];
  const textarea = {
    value: "",
    setAttribute: () => {},
    style: {} as Record<string, string>,
    focus: () => {},
    select: () => {},
  };
  const exec = vi.fn(() => {
    if (execOk === "throw") throw new Error("execCommand blocked");
    return execOk;
  });
  vi.stubGlobal("document", {
    createElement: () => textarea,
    body: {
      appendChild: (n: unknown) => appended.push(n),
      removeChild: () => {},
    },
    getSelection: () => null,
    execCommand: exec,
  });
  return { textarea, appended, exec };
}

describe("copyToClipboard", () => {
  it("copies via execCommand and returns true when it succeeds", () => {
    const { textarea, exec } = installDocument(true);

    expect(copyToClipboard("home.title")).toBe(true);
    expect(textarea.value).toBe("home.title");
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("does NOT throw when navigator.clipboard is undefined (the Figma sandbox case)", () => {
    // execCommand fails AND there's no async clipboard — must return false,
    // never throw (the bug: accessing navigator.clipboard.writeText threw
    // synchronously and aborted the whole copy handler).
    installDocument(false);
    vi.stubGlobal("navigator", {}); // no `clipboard` property at all

    expect(() => copyToClipboard("x")).not.toThrow();
    expect(copyToClipboard("x")).toBe(false);
  });

  it("falls back to the async Clipboard API when execCommand throws", () => {
    installDocument("throw");
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    expect(copyToClipboard("greeting")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("greeting");
  });

  it("returns false when execCommand returns false and clipboard.writeText is missing", () => {
    installDocument(false);
    vi.stubGlobal("navigator", { clipboard: {} }); // clipboard, but no writeText

    expect(copyToClipboard("x")).toBe(false);
  });
});
