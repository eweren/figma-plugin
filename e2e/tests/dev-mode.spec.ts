import { expect, test } from "@playwright/test";
import { SIGNED_IN, createTestNode, hostUrl } from "../host/fixtures";

const IFRAME_SELECTOR = '[data-testid="plugin-iframe"]';

/**
 * First e2e coverage for Dev Mode (the inspect-only editor) — the full app
 * now loads there (task 22), guarded by the navigation gate + per-component
 * hiding (task 21/22d). Production parity: language select, Pull/Download,
 * Copy page, String details and the resize handle are absent in dev; Push/
 * Upload stays.
 */

function bootUrl(editorType: "figma" | "dev") {
  const node = createTestNode({
    text: "On the road",
    key: "on-the-road-title",
    connected: true,
  });
  return hostUrl(SIGNED_IN, {
    allNodes: [node],
    selectedNodes: [node],
    hasUserSelection: true,
    editorType,
  });
}

test.describe("Dev Mode", () => {
  test("hides design-only affordances, keeps Upload", async ({ page }) => {
    await page.goto(bootUrl("dev"));
    const ui = page.frameLocator(IFRAME_SELECTOR);

    await expect(ui.getByText("1 selected")).toBeVisible({ timeout: 60_000 });

    // Upload (Push) stays — production keeps it in dev, it's metadata-only.
    await expect(ui.getByRole("button", { name: /Upload/ })).toBeVisible();
    // Download (Pull), Create page copy, language select: design-only, gone.
    await expect(ui.getByRole("button", { name: /Download/ })).not.toBeVisible();
    await expect(
      ui.getByRole("button", { name: "Create page copy" }),
    ).not.toBeVisible();
    await expect(ui.getByRole("combobox")).not.toBeVisible();
  });

  test("row menu offers Move to string but not String details; row click stays on Index", async ({
    page,
  }) => {
    await page.goto(bootUrl("dev"));
    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(ui.getByText("1 selected")).toBeVisible({ timeout: 60_000 });

    // Rows upgrade to their interactive form on hover.
    await ui.getByText("On the road").hover();
    await ui.getByRole("button", { name: "More actions" }).click();
    await expect(
      ui.getByRole("menuitem", { name: "Move to string" }),
    ).toBeVisible();
    await expect(
      ui.getByRole("menuitem", { name: "String details" }),
    ).not.toBeVisible();
    // Task 23: the deleted minipanel's three actions live here, dev-only.
    // This row is connected, so all three show (Open in Tolgee needs a
    // connected key to link to).
    await expect(ui.getByRole("menuitem", { name: "Copy key" })).toBeVisible();
    await expect(
      ui.getByRole("menuitem", { name: "Copy translation" }),
    ).toBeVisible();
    await expect(
      ui.getByRole("menuitem", { name: "Open in Tolgee" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Clicking the row text (a String-details entry point in design mode)
    // must be a silent no-op — the navigate() gate refuses the route.
    await ui.getByText("On the road").click();
    await expect(
      ui.getByRole("heading", { name: "String details" }),
    ).not.toBeVisible();
    await expect(ui.getByText("1 selected")).toBeVisible();
  });

  test("design editor keeps everything (regression guard)", async ({ page }) => {
    await page.goto(bootUrl("figma"));
    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(ui.getByText("1 selected")).toBeVisible({ timeout: 60_000 });

    await expect(ui.getByRole("button", { name: /Upload/ })).toBeVisible();
    await expect(ui.getByRole("button", { name: /Download/ })).toBeVisible();
    await expect(
      ui.getByRole("button", { name: "Create page copy" }),
    ).toBeVisible();

    await ui.getByText("On the road").hover();
    await ui.getByRole("button", { name: "More actions" }).click();
    await expect(
      ui.getByRole("menuitem", { name: "String details" }),
    ).toBeVisible();
    // The minipanel-replacement actions are dev-only — absent in design mode.
    await expect(
      ui.getByRole("menuitem", { name: "Copy key" }),
    ).not.toBeVisible();
    await expect(
      ui.getByRole("menuitem", { name: "Open in Tolgee" }),
    ).not.toBeVisible();
  });

  test("dev row menu omits Open in Tolgee for an unconnected row", async ({
    page,
  }) => {
    const unconnected = createTestNode({ text: "Loose text", connected: false });
    await page.goto(
      hostUrl(SIGNED_IN, {
        allNodes: [unconnected],
        selectedNodes: [unconnected],
        hasUserSelection: true,
        editorType: "dev",
      }),
    );
    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(ui.getByText("1 selected")).toBeVisible({ timeout: 60_000 });

    await ui.getByText("Loose text").hover();
    await ui.getByRole("button", { name: "More actions" }).click();
    await expect(
      ui.getByRole("menuitem", { name: "Move to string" }),
    ).toBeVisible();
    // No connected key -> a deep link would land on an empty search.
    await expect(
      ui.getByRole("menuitem", { name: "Open in Tolgee" }),
    ).not.toBeVisible();
  });
});
