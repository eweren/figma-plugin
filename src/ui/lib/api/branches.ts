import type { TolgeeClient } from "./client";

export type BranchInfo = { name: string; active?: boolean };

export async function fetchBranches(client: TolgeeClient): Promise<BranchInfo[]> {
  const { data } = await client.GET("/v2/projects/branches", {});
  const raw = data as {
    _embedded?: { branches?: Array<{ name?: string; active?: boolean }> };
  };
  return (raw._embedded?.branches ?? [])
    .filter((b): b is { name: string; active?: boolean } => Boolean(b.name))
    .map((b) => ({ name: b.name, active: b.active }));
}

/**
 * The branch to pre-select when none is chosen yet: the active one, else the
 * conventional "main", else the first — so a branching-enabled project never
 * sits on an empty branch. "" only when there are no branches at all.
 */
export function pickDefaultBranch(branches: BranchInfo[]): string {
  if (branches.length === 0) return "";
  return (
    branches.find((b) => b.active)?.name ??
    branches.find((b) => b.name === "main")?.name ??
    branches[0]?.name ??
    ""
  );
}
