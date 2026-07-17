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

  test("shows the keys message and no Download button when no language is configured", async ({
    page,
  }) => {
    await page.goto(hostUrl(PAGE_COPY));

    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      ui.getByText("Shows Tolgee keys — doesn't sync back."),
    ).toBeVisible();
    await expect(
      ui.getByRole("button", { name: "Download all" }),
    ).not.toBeVisible();
  });

  test("shows the download instruction and a Download button when a language is configured", async ({
    page,
  }) => {
    await page.goto(hostUrl({ ...PAGE_COPY, language: "cs" }));

    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      ui.getByText(
        "Download the current version of strings from Tolgee to Figma.",
      ),
    ).toBeVisible();
    // Nothing selected in this fixture -> "Download all" (vs "Download" for a selection).
    await expect(
      ui.getByRole("button", { name: "Download all" }),
    ).toBeVisible();
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
