import type { TolgeeClient } from "./client";

export type BranchInfo = { name: string; isDefault?: boolean };

export async function fetchBranches(client: TolgeeClient): Promise<BranchInfo[]> {
  const { data } = await client.GET("/v2/projects/branches", {});
  const raw = data as {
    _embedded?: { branches?: Array<{ name?: string; isDefault?: boolean }> };
  };
  return (raw._embedded?.branches ?? [])
    .filter((b): b is { name: string; isDefault?: boolean } => Boolean(b.name))
    .map((b) => ({ name: b.name, isDefault: b.isDefault }));
}

/**
 * The branch to pre-select when none is chosen yet: the project's default
 * branch (`isDefault`, same rule as the original plugin), else the
 * conventional "main", else the first — so a branching-enabled project never
 * sits on an empty branch. "" only when there are no branches at all.
 * NOT `active` — that flag just means "not archived" and can be true for many
 * branches at once, so it would pick an arbitrary feature branch.
 */
export function pickDefaultBranch(branches: BranchInfo[]): string {
  if (branches.length === 0) return "";
  return (
    branches.find((b) => b.isDefault)?.name ??
    branches.find((b) => b.name === "main")?.name ??
    branches[0]?.name ??
    ""
  );
}
