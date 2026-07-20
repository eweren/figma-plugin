import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";
import { writeConfig } from "$main/settings";
import { readGlobalSettings, writeGlobalSettings } from "$main/settings/storage";

/**
 * Minimal fake covering exactly what `writeConfig` touches: clientStorage
 * (global scope), `figma.root` pluginData (document scope), and
 * `figma.currentPage` pluginData (page scope) — including the
 * `loadAsync()` the dynamic-page-access path awaits before touching it.
 */
function installFigma() {
  const clientStorage = new Map<string, unknown>();
  const rootPluginData = new Map<string, string>();
  const pagePluginData = new Map<string, string>();
  return installFigmaWith(clientStorage, rootPluginData, pagePluginData);
}

function installFigmaWith(
  clientStorage: Map<string, unknown>,
  rootPluginData: Map<string, string>,
  pagePluginData: Map<string, string>,
) {

  (globalThis as unknown as { figma: unknown }).figma = {
    clientStorage: {
      getAsync: async (key: string) => clientStorage.get(key),
      setAsync: async (key: string, value: unknown) => {
        clientStorage.set(key, value);
      },
      deleteAsync: async (key: string) => {
        clientStorage.delete(key);
      },
    },
    root: {
      getPluginData: (key: string) => rootPluginData.get(key) ?? "",
      setPluginData: (key: string, value: string) => {
        rootPluginData.set(key, value);
      },
    },
    currentPage: {
      loadAsync: async () => {},
      getPluginData: (key: string) => pagePluginData.get(key) ?? "",
      setPluginData: (key: string, value: string) => {
        pagePluginData.set(key, value);
      },
    },
  };

  return { clientStorage, rootPluginData, pagePluginData };
}

beforeEach(() => {
  installFigma();
});

afterEach(() => {
  (globalThis as unknown as { figma?: unknown }).figma = undefined;
});

describe("writeConfig", () => {
  it("persists documentInfo:true to document scope and pageInfo:true to page scope", async () => {
    const { rootPluginData, pagePluginData } = installFigma();

    // Mirrors what the `save-config` handler in main.ts now passes: the UI's
    // submitted config plus the two production-parity scope markers.
    await writeConfig({
      apiUrl: "https://app.tolgee.io",
      documentInfo: true,
      pageInfo: true,
    });

    const doc = JSON.parse(rootPluginData.get(TOLGEE_PLUGIN_CONFIG_NAME) ?? "{}");
    const page = JSON.parse(pagePluginData.get(TOLGEE_PLUGIN_CONFIG_NAME) ?? "{}");

    expect(doc.documentInfo).toBe(true);
    expect(page.pageInfo).toBe(true);
    // And they land in the right scope only — not cross-leaked.
    expect(page.documentInfo).toBeUndefined();
    expect(doc.pageInfo).toBeUndefined();
  });
});

describe("global settings clientStorage format (rollback compatibility)", () => {
  it("persists a JSON STRING the published plugin's unguarded JSON.parse can read", async () => {
    const { clientStorage } = installFigma();

    await writeGlobalSettings({ apiUrl: "https://app.tolgee.io", apiKey: "k" });

    const stored = clientStorage.get(TOLGEE_PLUGIN_CONFIG_NAME);
    // The PUBLISHED plugin reads this value with a bare `JSON.parse(value)`
    // at startup (settingsTools.ts) — a raw object here would brick it after
    // a rollback. This assertion IS that reader.
    expect(typeof stored).toBe("string");
    expect(JSON.parse(stored as string)).toEqual({
      apiUrl: "https://app.tolgee.io",
      apiKey: "k",
    });
  });

  it("still reads back both legacy-string and (historical) object shapes", async () => {
    const { clientStorage } = installFigma();

    clientStorage.set(TOLGEE_PLUGIN_CONFIG_NAME, JSON.stringify({ apiKey: "s" }));
    expect(await readGlobalSettings()).toEqual({ apiKey: "s" });

    // Docs touched by the brief window where we stored raw objects must not
    // lose their settings either.
    clientStorage.set(TOLGEE_PLUGIN_CONFIG_NAME, { apiKey: "o" });
    expect(await readGlobalSettings()).toEqual({ apiKey: "o" });
  });
});
