import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTolgeeClient } from "../client";
import { fetchRemoteKeys } from "../keysByName";

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

function errorResponse(status = 500) {
  return new Response(JSON.stringify({ code: "server_error" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_ROW = {
  keyName: "key.one",
  keyNamespace: "common",
  keyIsPlural: false,
  keyTags: [{ name: "tag-a" }],
  translations: { en: { text: "Hello" } },
};

beforeEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("fetchRemoteKeys", () => {
  it("returns [] when filterKeyName is an empty array", async () => {
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");
    const result = await fetchRemoteKeys(client, { filterKeyName: [] });
    expect(result).toEqual([]);
  });

  it("returns keys from _embedded.keys", async () => {
    installFetchMock(async () => okResponse({ _embedded: { keys: [SAMPLE_ROW] } }));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    const result = await fetchRemoteKeys(client, {
      filterKeyName: ["key.one"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(SAMPLE_ROW);
  });

  it("falls back to pagedModel._embedded.keys when _embedded is missing", async () => {
    installFetchMock(async () => okResponse({ pagedModel: { _embedded: { keys: [SAMPLE_ROW] } } }));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    const result = await fetchRemoteKeys(client, {
      filterKeyName: ["key.one"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(SAMPLE_ROW);
  });

  it("throws on API error instead of silently returning []", async () => {
    installFetchMock(async () => errorResponse(500));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    await expect(
      fetchRemoteKeys(client, {
        filterKeyName: ["key.one"],
      }),
    ).rejects.toThrow();
  });

  it("passes branch param in query when provided", async () => {
    const mock = installFetchMock(async () => okResponse({ _embedded: { keys: [] } }));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");

    await fetchRemoteKeys(client, {
      filterKeyName: ["key.one"],
      branch: "feature/my-branch",
    });

    const calledUrl: string =
      mock.mock.calls[0]?.[0] instanceof Request
        ? mock.mock.calls[0][0].url
        : String(mock.mock.calls[0]?.[0] ?? "");

    expect(calledUrl).toContain("branch=feature%2Fmy-branch");
  });

  // ---------------------------------------------------------------------
  // Batching (>200 names split into multiple parallel requests)
  // ---------------------------------------------------------------------

  function calledUrl(mock: FetchMock, callIndex: number): URL {
    const arg = mock.mock.calls[callIndex]?.[0];
    const raw = arg instanceof Request ? arg.url : String(arg ?? "");
    return new URL(raw);
  }

  function rowFor(name: string) {
    return {
      keyName: name,
      keyNamespace: undefined,
      keyIsPlural: false,
      translations: { en: { text: `text-${name}` } },
    };
  }

  it("splits 450 key names into 3 batches of <=200 and merges the results", async () => {
    const mock = installFetchMock(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const names = url.searchParams.getAll("filterKeyName");
      expect(names.length).toBeLessThanOrEqual(200);
      return okResponse({ _embedded: { keys: names.map(rowFor) } });
    });

    const client = createTolgeeClient("https://app.tolgee.io", "test-key");
    const filterKeyName = Array.from({ length: 450 }, (_, i) => `key-${i}`);

    const result = await fetchRemoteKeys(client, { filterKeyName });

    expect(mock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(450);
    expect(new Set(result.map((r) => r.keyName))).toEqual(new Set(filterKeyName));
  });

  it("does not batch a small request (<=200 names) — still a single request", async () => {
    const mock = installFetchMock(async () => okResponse({ _embedded: { keys: [] } }));
    const client = createTolgeeClient("https://app.tolgee.io", "test-key");
    const filterKeyName = Array.from({ length: 150 }, (_, i) => `key-${i}`);

    await fetchRemoteKeys(client, { filterKeyName });

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("propagates an error from any single batch as a failure of the whole call", async () => {
    let callCount = 0;
    installFetchMock(async () => {
      callCount++;
      // Fail the 2nd batch specifically.
      if (callCount === 2) return errorResponse(500);
      return okResponse({ _embedded: { keys: [] } });
    });

    const client = createTolgeeClient("https://app.tolgee.io", "test-key");
    const filterKeyName = Array.from({ length: 450 }, (_, i) => `key-${i}`);

    await expect(fetchRemoteKeys(client, { filterKeyName })).rejects.toThrow();
  });

  it("follows cursor pagination within a single batch and merges all pages", async () => {
    const filterKeyName = ["a", "b"];
    let callCount = 0;
    const mock = installFetchMock(async () => {
      callCount++;
      if (callCount === 1) {
        return okResponse({
          _embedded: { keys: [rowFor("a")] },
          nextCursor: "cursor-1",
        });
      }
      return okResponse({ _embedded: { keys: [rowFor("b")] } });
    });

    const client = createTolgeeClient("https://app.tolgee.io", "test-key");
    const result = await fetchRemoteKeys(client, { filterKeyName });

    expect(mock).toHaveBeenCalledTimes(2);
    expect(calledUrl(mock, 1).searchParams.get("cursor")).toBe("cursor-1");
    expect(result.map((r) => r.keyName).sort()).toEqual(["a", "b"]);
  });
});
