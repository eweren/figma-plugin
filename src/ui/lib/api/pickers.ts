import type { TolgeeClient } from "$ui/lib/api/client";
import { auth } from "$ui/lib/stores/auth.svelte";

/**
 * Fetch the project's languages and used namespaces into the auth store, so the
 * header/settings/onboarding pickers are populated without each one re-fetching.
 * Errors are swallowed — the UI falls back to "current value only".
 *
 * Called from BOTH the startup bootstrap (App.svelte, when config already has
 * valid credentials) AND a manual Connect (SettingsSectionConnection). Without
 * the manual-connect call, a first-time connect (onboarding, or Settings on a
 * fresh document) left the language/namespace selects empty until reopen.
 */
export async function hydratePickers(client: TolgeeClient): Promise<void> {
  try {
    const { data } = await client.GET("/v2/projects/languages", {
      params: { query: { size: 1000 } },
    });
    const raw = data as {
      _embedded?: {
        languages?: Array<{ tag?: string; name?: string; base?: boolean }>;
      };
    };
    const list = raw._embedded?.languages ?? [];
    const base = list.find((l) => l.base)?.tag ?? "";
    auth.setLanguages(
      list
        .filter((l): l is { tag: string; name?: string } => Boolean(l.tag))
        .map((l) => ({ tag: l.tag, name: l.name ?? l.tag })),
      base,
    );
  } catch {
    auth.setLanguages([]);
  }
  try {
    const { data } = await client.GET("/v2/projects/used-namespaces", {});
    const raw = data as {
      _embedded?: { namespaces?: Array<{ name?: string }> };
    };
    const list = raw._embedded?.namespaces ?? [];
    auth.setNamespaces(
      list
        .filter((n): n is { name: string } => Boolean(n.name))
        .map((n) => ({ name: n.name })),
    );
  } catch {
    auth.setNamespaces([]);
  }
}
