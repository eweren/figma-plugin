import type { TolgeeClient } from "$ui/lib/api/client";

export type RemoteKeyRow = {
  keyName: string;
  keyNamespace?: string;
  keyIsPlural?: boolean;
  keyTags?: Array<{ name: string }>;
  translations?: Record<string, { text?: string } | undefined>;
};

export type FetchRemoteKeysOptions = {
  filterKeyName: string[];
  filterNamespace?: string[];
  language?: string;
  branch?: string;
  signal?: AbortSignal;
};

const PAGE_SIZE = 1000;

// `filterKeyName` is a repeated query param — sending hundreds of names in one
// request risks exceeding proxy/server URL length limits (~8KB), which fails
// outright with a network error. Batching keeps every request's URL short and
// well under the 1000-item page size in the common case (see the cursor loop
// below for the rare case where it doesn't).
const BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Fetch one batch of key names, following `cursor`/`nextCursor` pagination
 * until exhausted. A single batch (~200 names) fits within one page in the
 * overwhelming majority of cases, so this loop typically runs once — it only
 * keeps going if many namespaces multiply the batch's result count past the
 * page size. Mirrors the pagination pattern in `pull.ts`'s
 * `fetchAllTranslations`.
 */
async function fetchBatch(
  client: TolgeeClient,
  filterKeyName: string[],
  options: Pick<FetchRemoteKeysOptions, "filterNamespace" | "language" | "branch" | "signal">,
): Promise<RemoteKeyRow[]> {
  const out: RemoteKeyRow[] = [];
  let cursor: string | undefined;

  while (true) {
    const { data, error } = await client.GET("/v2/projects/translations", {
      params: {
        query: {
          languages: options.language ? [options.language] : undefined,
          filterKeyName,
          filterNamespace: options.filterNamespace,
          size: PAGE_SIZE,
          cursor,
          branch: options.branch || undefined,
        },
      },
      signal: options.signal,
    });

    if (error || !data) {
      const code =
        (error as { code?: string } | undefined)?.code ??
        (typeof error === "string" ? error : null);
      throw code ? new Error(code) : new Error("Failed to fetch remote keys");
    }

    // Response shape: `_embedded.keys` (newer) or `pagedModel._embedded.keys`.
    const raw = data as {
      _embedded?: { keys?: unknown[] };
      pagedModel?: { _embedded?: { keys?: unknown[] } };
      nextCursor?: string;
    };
    const batch = (raw._embedded?.keys ?? raw.pagedModel?._embedded?.keys ?? []) as RemoteKeyRow[];
    out.push(...batch);

    cursor = raw.nextCursor;
    if (!cursor || batch.length === 0) {
      return out;
    }
  }
}

/**
 * Fetch a fixed set of keys by name (and optional namespace) for the diff
 * preview on the push screen.
 *
 * `filterKeyName` is split into batches of `BATCH_SIZE` names, each issued as
 * its own request (in parallel — these are independent reads), and each
 * batch follows cursor pagination defensively. Results are merged into a
 * single flat array with the exact same shape this function returned before
 * batching was introduced, so callers (`pushDiff.ts` via `Push.svelte` and
 * `pushFlow.ts`) need no changes.
 *
 * Any batch failing fails the whole call — we throw rather than silently
 * returning `[]`, since a swallowed error here previously looked identical
 * to "no remote keys found" and made `pushDiff` misreport existing keys as
 * deleted on the platform.
 */
export async function fetchRemoteKeys(
  client: TolgeeClient,
  options: FetchRemoteKeysOptions,
): Promise<RemoteKeyRow[]> {
  if (options.filterKeyName.length === 0) return [];

  const batches = chunk(options.filterKeyName, BATCH_SIZE);
  const results = await Promise.all(
    batches.map((filterKeyName) =>
      fetchBatch(client, filterKeyName, {
        filterNamespace: options.filterNamespace,
        language: options.language,
        branch: options.branch,
        signal: options.signal,
      }),
    ),
  );
  return results.flat();
}
