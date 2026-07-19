import type { MainToUi, UiToMain } from "$shared/messages";
import { DEV_ALLOWED_IMPACTS, MESSAGE_IMPACT } from "$shared/messagePolicy";

type Handlers = {
  [K in UiToMain["type"]]?: (msg: Extract<UiToMain, { type: K }>) => void | Promise<void>;
};

const handlers: Handlers = {};

export function send(msg: MainToUi): void {
  figma.ui.postMessage(msg);
}

export function on<K extends UiToMain["type"]>(
  type: K,
  handler: (msg: Extract<UiToMain, { type: K }>) => void | Promise<void>,
): void {
  handlers[type] = handler as Handlers[K];
}

export function attachBus(): void {
  figma.ui.onmessage = async (msg: UiToMain) => {
    // Dev Mode is inspect-only: hard-block anything classified as a canvas
    // write (see $shared/messagePolicy — the exhaustive impact map is the
    // single defence layer, not per-call-site conditions). The UI hides the
    // affordances that send these, so reaching this guard is an anomaly
    // worth surfacing to the user, not a silent drop.
    if (figma.editorType === "dev" && !DEV_ALLOWED_IMPACTS.has(MESSAGE_IMPACT[msg.type])) {
      figma.notify("Not available in Dev Mode");
      console.warn("[tolgee:main] blocked canvas message in Dev Mode:", msg.type);
      return;
    }
    const handler = handlers[msg.type] as ((m: UiToMain) => void | Promise<void>) | undefined;
    if (handler) {
      await handler(msg);
    } else {
      // TODO: implement — no handler registered for this UiToMain type yet.
      console.log("[tolgee:main] unhandled message", msg);
    }
  };
}
