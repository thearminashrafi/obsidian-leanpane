/** Finding an already open leaf, including leaves Obsidian has not loaded yet (deferred views). Pure; no "obsidian". */

export interface LeafLike {
  view: unknown;
  getViewState(): { state?: unknown };
  /** Obsidian >= 1.7.2: instantiate a deferred view. */
  loadIfDeferred?(): Promise<void>;
}

/**
 * First leaf that shows the wanted file. Loaded views are tested with `viewMatches`; a leaf whose view is not (yet) a
 * `V` (a deferred placeholder) is tested through its saved state and loaded on demand. Without this, opening a file
 * that already has a not-yet-loaded tab creates a duplicate tab.
 */
export async function findLeaf<L extends LeafLike, V>(
  leaves: L[],
  isView: (v: unknown) => v is V,
  viewMatches: (v: V) => boolean,
  stateMatches: (state: any) => boolean,
): Promise<{ leaf: L; view: V } | null> {
  for (const leaf of leaves) if (isView(leaf.view) && viewMatches(leaf.view)) return { leaf, view: leaf.view };
  for (const leaf of leaves) {
    if (isView(leaf.view)) continue;
    let state: unknown;
    try {
      state = leaf.getViewState().state;
    } catch {
      continue;
    }
    if (!state || !stateMatches(state)) continue;
    try {
      await leaf.loadIfDeferred?.();
    } catch {
      continue;
    }
    if (isView(leaf.view)) return { leaf, view: leaf.view };
  }
  return null;
}
