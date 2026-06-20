// Expanding a geo filter to match the choropleth roll-up. The map counts an oblast as the
// de-duplicated union of its own datasets PLUS all of its municipalities' (spec 013, via the
// `part_of` graph). So filtering by an oblast must include its municipalities too — otherwise
// selecting an oblast shows only its oblast-level datasets (far fewer than the map's count).
// Pure + unit-tested; the oblast->children map comes from ReadBridge.partOfChildren().

/**
 * Expand each oblast id in `geoUnitIds` to itself + its child municipality ids. Municipality
 * (leaf) ids and unknown ids pass through unchanged. Returns the de-duplicated union.
 */
export function expandGeoUnitIds(
  geoUnitIds: string[],
  childrenOf: Map<string, string[]>,
): string[] {
  if (geoUnitIds.length === 0) return geoUnitIds;
  const out = new Set<string>();
  for (const id of geoUnitIds) {
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) out.add(child);
  }
  return [...out];
}
