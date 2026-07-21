import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBranches, pickDefaultBranch } from "../branches";
import { createTolgeeClient } from "../client";

type FetchMock = ReturnType<typeof vi.fn>;

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchMock(impl: (...args: unknown[]) => Promise<Response>) {
  const mock: FetchMock = vi.fn(impl as never);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("fetchBranches", () => {
  it("returns branch names from the response", async () => {
    installFetchMock(async () =>
      okResponse({
        _embedded: {
          branches: [
            { name: "main", isDefault: true },
            { name: "feature/x", isDefault: false },
          ],
        },
      }),
    );
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    const result = await fetchBranches(client);

    expect(result).toEqual([
      { name: "main", isDefault: true },
      { name: "feature/x", isDefault: false },
    ]);
  });

  it("returns [] when _embedded is missing", async () => {
    installFetchMock(async () => okResponse({}));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    const result = await fetchBranches(client);

    expect(result).toEqual([]);
  });

  it("filters out entries that have no name", async () => {
    installFetchMock(async () =>
      okResponse({
        _embedded: {
          branches: [
            { name: "main", isDefault: true },
            { isDefault: false }, // name undefined
            { name: "", isDefault: false }, // name empty string (falsy)
          ],
        },
      }),
    );
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    const result = await fetchBranches(client);

    expect(result).toEqual([{ name: "main", isDefault: true }]);
  });

  it("returns [] when the branches array is empty", async () => {
    installFetchMock(async () => okResponse({ _embedded: { branches: [] } }));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    const result = await fetchBranches(client);

    expect(result).toEqual([]);
  });
});

describe("pickDefaultBranch", () => {
  it("prefers the default branch (isDefault, like the original plugin)", () => {
    expect(
      pickDefaultBranch([
        { name: "main", isDefault: false },
        { name: "feature/x", isDefault: true },
      ]),
    ).toBe("feature/x");
  });

  it('falls back to "main" when none is marked default', () => {
    expect(
      pickDefaultBranch([{ name: "dev" }, { name: "main" }]),
    ).toBe("main");
  });

  it('falls back to the first branch when no default and no "main"', () => {
    expect(pickDefaultBranch([{ name: "dev" }, { name: "staging" }])).toBe("dev");
  });

  it("returns an empty string when there are no branches", () => {
    expect(pickDefaultBranch([])).toBe("");
  });
});
