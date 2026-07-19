import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Narrow test for the `on("set-nodes-data", ...)` handler wired up in
 * `main.ts`. `setNodesData` itself (in `$main/nodes/selection`) is already
 * well covered (see `nodes/__tests__/selection.test.ts`, task 7) — this test
 * only checks that the main-thread MESSAGE HANDLER correctly forwards
 * `setNodesData`'s `onProgress` callback into `nodes-set-progress` UI
 * messages, and sends `nodes-set-result` at the end.
 *
 * `main.ts` has no exported, individually-invokable handler functions — every
 * `on(...)` registration is an inline arrow function, and the file runs
 * side-effecting top-level code (`figma.showUI`, `figma.on(...)`,
 * `attachBus()`) at import time. Rather than refactor the whole file's
 * handler-registration pattern just to make ONE handler unit-testable in
 * isolation (out of proportion for this cleanup task — see task 14g), this
 * test drives it the way the real bridge does: `attachBus()` (called at
 * module top level) assigns `figma.ui.onmessage` to the actual dispatcher, so
 * invoking that with a `set-nodes-data` message exercises the exact handler
 * registered in `main.ts`, with no behavioural changes to the source file.
 */

/** Minimal TEXT-node stand-in — same shape `selection.test.ts` uses for
 *  `setNodesData`'s `figma.getNodeByIdAsync` lookups. */
function makeTextNode(id: string, characters: string) {
  const pluginData = new Map<string, string>();
  return {
    id,
    type: "TEXT" as const,
    name: `Layer ${id}`,
    characters,
    visible: true,
    autoRename: true,
    getPluginData: (key: string) => pluginData.get(key) ?? "",
    setPluginData: (key: string, value: string) => {
      pluginData.set(key, value);
    },
    getRangeAllFontNames: () => [{ family: "Inter", style: "Regular" }],
  };
}

type FakeNode = ReturnType<typeof makeTextNode>;
type FakeFigma = {
  editorType: "figma" | "dev";
  command: string;
  currentPage: { selection: unknown[] };
  skipInvisibleInstanceChildren: boolean;
  showUI: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  ui: { postMessage: ReturnType<typeof vi.fn>; onmessage?: (msg: unknown) => unknown };
  getNodeByIdAsync: (id: string) => Promise<FakeNode | null>;
};

/** Installs a fresh `figma` global (+ the two build-time UI-html injected
 *  globals `main.ts` reads at module scope) and imports `main.ts` fresh, so
 *  its top-level `attachBus()` wires `figma.ui.onmessage` for this test. */
async function loadMain(
  nodes: FakeNode[],
  editorType: "figma" | "dev" = "figma",
): Promise<FakeFigma> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const figma: FakeFigma = {
    editorType,
    command: "",
    currentPage: { selection: [] },
    skipInvisibleInstanceChildren: false,
    showUI: vi.fn(),
    notify: vi.fn(),
    on: vi.fn(),
    ui: { postMessage: vi.fn() },
    getNodeByIdAsync: async (id: string) => byId.get(id) ?? null,
  };
  (globalThis as unknown as { figma: unknown }).figma = figma;
  (globalThis as unknown as { __uiFiles__: unknown }).__uiFiles__ = { figma: "<html></html>" };
  (globalThis as unknown as { __html__: unknown }).__html__ = "";

  vi.resetModules();
  await import("../main");

  return figma;
}

afterEach(() => {
  (globalThis as unknown as { figma?: unknown }).figma = undefined;
  (globalThis as unknown as { __uiFiles__?: unknown }).__uiFiles__ = undefined;
  (globalThis as unknown as { __html__?: unknown }).__html__ = undefined;
  vi.restoreAllMocks();
});

describe('main.ts on("set-nodes-data", ...) handler', () => {
  it("forwards setNodesData's onProgress into nodes-set-progress, then sends nodes-set-result", async () => {
    const nodes = Array.from({ length: 250 }, (_, i) => makeTextNode(`1:${i}`, `text ${i}`));
    const figma = await loadMain(nodes);
    expect(figma.ui.onmessage).toBeTypeOf("function");

    const updates = nodes.map((n) => ({ id: n.id, info: { key: `k${n.id}` } }));
    await figma.ui.onmessage?.({
      type: "set-nodes-data",
      correlationId: "corr-1",
      nodes: updates,
    });

    const calls = figma.ui.postMessage.mock.calls.map((c) => c[0] as { type: string });

    const progressMsgs = calls.filter((m) => m.type === "nodes-set-progress") as Array<{
      type: "nodes-set-progress";
      correlationId: string;
      done: number;
      total: number;
    }>;
    // setNodesData yields (and reports progress) every 50 updates, only when
    // total > 100 — 250 updates -> 5 progress messages, done reaching total.
    expect(progressMsgs).toHaveLength(5);
    for (const msg of progressMsgs) {
      expect(msg.correlationId).toBe("corr-1");
      expect(msg.total).toBe(250);
    }
    expect(progressMsgs[0]?.done).toBe(50);
    expect(progressMsgs.at(-1)?.done).toBe(250);

    const resultMsgs = calls.filter((m) => m.type === "nodes-set-result") as Array<{
      type: "nodes-set-result";
      correlationId: string;
      ok: boolean;
      nodes: unknown[];
    }>;
    expect(resultMsgs).toHaveLength(1);
    expect(resultMsgs[0]?.correlationId).toBe("corr-1");
    expect(resultMsgs[0]?.ok).toBe(true);
    expect(resultMsgs[0]?.nodes).toHaveLength(250);
  });

  it("sends no progress messages for a small batch (<=100), still sends the result", async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeTextNode(`1:${i}`, `text ${i}`));
    const figma = await loadMain(nodes);

    const updates = nodes.map((n) => ({ id: n.id, info: { key: `k${n.id}` } }));
    await figma.ui.onmessage?.({
      type: "set-nodes-data",
      correlationId: "corr-2",
      nodes: updates,
    });

    const calls = figma.ui.postMessage.mock.calls.map((c) => c[0] as { type: string });
    expect(calls.filter((m) => m.type === "nodes-set-progress")).toHaveLength(0);
    expect(calls.filter((m) => m.type === "nodes-set-result")).toHaveLength(1);
  });
});

describe("Dev-Mode canvas guard (attachBus + MESSAGE_IMPACT)", () => {
  it("blocks a canvas message in dev: handler never runs, user gets a toast", async () => {
    const figma = await loadMain([], "dev");
    // Silence the guard's console.warn — it's the expected path here.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await figma.ui.onmessage?.({
      type: "apply-translations",
      correlationId: "corr-dev-1",
      updates: [],
    });

    // Blocked BEFORE the handler: no apply-translations-result ever posted.
    const calls = figma.ui.postMessage.mock.calls.map((c) => c[0] as { type: string });
    expect(calls.filter((m) => m.type === "apply-translations-result")).toHaveLength(0);
    expect(figma.notify).toHaveBeenCalledWith("Not available in Dev Mode");
  });

  it("lets a metadata message through in dev (production parity: Push works there)", async () => {
    const node = makeTextNode("1:1", "Hello");
    const figma = await loadMain([node], "dev");

    await figma.ui.onmessage?.({
      type: "set-nodes-data",
      correlationId: "corr-dev-2",
      nodes: [{ id: "1:1", info: { key: "k" } }],
    });

    const calls = figma.ui.postMessage.mock.calls.map((c) => c[0] as { type: string });
    expect(calls.filter((m) => m.type === "nodes-set-result")).toHaveLength(1);
    expect(figma.notify).not.toHaveBeenCalled();
  });

  it("does not interfere in the design editor: canvas messages run, no toast", async () => {
    const figma = await loadMain([], "figma");

    await figma.ui.onmessage?.({
      type: "apply-translations",
      correlationId: "corr-fig-1",
      updates: [],
    });

    const calls = figma.ui.postMessage.mock.calls.map((c) => c[0] as { type: string });
    expect(calls.filter((m) => m.type === "apply-translations-result")).toHaveLength(1);
    expect(figma.notify).not.toHaveBeenCalled();
  });
});
