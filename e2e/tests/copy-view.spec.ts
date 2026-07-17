import { expect, test } from "@playwright/test";
import { PAGE_COPY, hostUrl } from "../host/fixtures";

const IFRAME_SELECTOR = '[data-testid="plugin-iframe"]';

test.describe("CopyView", () => {
  test("shows the page name (copy) heading for pageCopy config", async ({
    page,
  }) => {
    // No explicit pageName in the fixture -> the host's default ("Page 1").
    await page.goto(hostUrl(PAGE_COPY));

    const ui = page.frameLocator(IFRAME_SELECTOR);

    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows the keys message and no Pull button when no language is configured", async ({
    page,
  }) => {
    await page.goto(hostUrl(PAGE_COPY));

    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      ui.getByText("Texts here show Tolgee keys and don't sync back."),
    ).toBeVisible();
    await expect(ui.getByRole("button", { name: "Pull all" })).not.toBeVisible();
  });

  test("shows the sync info message and a Pull button when a language is configured", async ({
    page,
  }) => {
    await page.goto(hostUrl({ ...PAGE_COPY, language: "cs" }));

    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      ui.getByText(
        "Texts here don't sync back to Tolgee. Pull updates them with the latest translations.",
      ),
    ).toBeVisible();
    // Nothing selected in this fixture -> "Pull all" (vs "Pull" for a selection).
    await expect(ui.getByRole("button", { name: "Pull all" })).toBeVisible();
  });

  test("Settings is reachable from a copy page context", async ({ page }) => {
    await page.goto(hostUrl(PAGE_COPY, { route: "settings" }));

    const ui = page.frameLocator(IFRAME_SELECTOR);

    await expect(ui.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(ui.locator("#settings-api-url")).toBeVisible();
  });
});
