import type { TolgeeClient } from "$ui/lib/api/client";

/** A connected key to verify against the server. `ns` undefined = default namespace. */
export type ConnectedKey = { name: string; ns: string | undefined };

/**
 * Stable identity for a (namespace, name) pair — used to match a node against
 * the "missing" set. ` ` can't appear in a Figma-authored key/namespace,
 * so it's a collision-proof separator. `ns` is normalised so undefined and ""
 * (both "no namespace" / Tolgee's "<none>") map to the same signature.
 */
export function connectedKeySig(ns: string | undefined, name: string): string {
  return `${ns || ""} ${name}`;
}

/**
 * Returns the connected keys that NO LONGER EXIST in the Tolgee project, as
 * `connectedKeySig` signatures.
 *
 * One `POST /keys/info` with explicit {name, namespace} pairs — the endpoint
 * omits keys it can't find, so anything we asked for that isn't in the response
 * has been deleted. Explicit pairs make namespace matching exact (including the
 * default "<none>" namespace, sent as `namespace: undefined`), with no reliance
 * on empty-string query-param quirks.
 *
 * Fail-safe: on any request error we report nothing missing, so a transient
 * failure never false-flags a live link.
 */
export async function fetchMissingKeys(
  client: TolgeeClient,
  keys: ConnectedKey[],
  branch: string,
  languageTag?: string,
): Promise<Set<string>> {
  const missing = new Set<string>();
  if (keys.length === 0) return missing;

  const { data, error } = await client.POST("/v2/projects/keys/info", {
    params: { query: { branch: branch || undefined } },
    body: {
      keys: keys.map((k) => ({ name: k.name, namespace: k.ns || undefined })),
      // Existence doesn't depend on a language, but the endpoint requires the
      // field; send one when we have it, else an empty list.
      languageTags: languageTag ? [languageTag] : [],
    },
  });
  if (error || !data) return missing; // fail-safe: never flag on error

  const present = new Set(
    (data._embedded?.keys ?? []).map((k) => connectedKeySig(k.namespace, k.name)),
  );
  for (const k of keys) {
    const sig = connectedKeySig(k.ns, k.name);
    if (!present.has(sig)) missing.add(sig);
  }
  return missing;
}
