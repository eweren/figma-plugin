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

  test("shows the keys info tooltip and no Download button when no language is configured", async ({
    page,
  }) => {
    await page.goto(hostUrl(PAGE_COPY));

    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });

    // The "Shows Tolgee keys. Doesn't sync back." explanation now lives in
    // this (i) tooltip in the header instead of a static line in the body.
    await expect(
      ui.getByRole("button", { name: "About this page" }),
    ).toBeVisible();
    await expect(
      ui.getByRole("button", { name: "Download all" }),
    ).not.toBeVisible();
  });

  test("shows the download instruction empty state and a Download button when a language is configured", async ({
    page,
  }) => {
    await page.goto(hostUrl({ ...PAGE_COPY, language: "cs" }));

    const ui = page.frameLocator(IFRAME_SELECTOR);
    await expect(
      ui.getByRole("heading", { name: "Page 1 (copy)" }),
    ).toBeVisible({ timeout: 10_000 });

    // Nothing selected + never downloaded this session -> the big
    // instructional EmptyState carries the message, no separate top line.
    await expect(
      ui.getByText("Download strings to Figma."),
    ).toBeVisible();
    await expect(
      ui.getByText("All, or just the selected frames."),
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
