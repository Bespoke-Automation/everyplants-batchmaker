/**
 * Tag-based packaging filter configuration.
 *
 * Maps Picqer tag IDs to a curated set of packaging IDs.
 * When an order/picklist carries one of these tags the "Add Box" modal
 * will only show the listed packagings instead of the full catalogue.
 */

interface TagPackagingFilterGroup {
  /** Human-readable label shown as section header in the modal */
  label: string
  /** Picqer tag IDs that activate this filter */
  tagIds: number[]
  /** Picqer packaging IDs to show (order = display order) */
  packagingIds: number[]
}

export const TAG_PACKAGING_FILTERS: TagPackagingFilterGroup[] = [
  {
    label: 'Plantura',
    tagIds: [252919], // Plantura
    packagingIds: [
      1029,  // Fold box 98 - 55_921
      1064,  // Fold box 160 - 55_919
      1065,  // Sale box 170cm - 55_1099
      1066,  // PL - Box Single Small – doublepack strapped - 333017047
      1067,  // PL-Single-Small - 333017006
      1068,  // PL-Single-Big - 333017007
      1069,  // PL-Multi-Small - 333017008
      1070,  // PL-Multi-Big - 333017009
      1071,  // PL-Save me 4pcs - 333017010
      1072,  // PL-Save me 12pcs - 333017011
    ],
  },
  {
    label: 'XL / De Rooy / TOV',
    tagIds: [
      234706, // 15. Open box (colli)
      234707, // 16. HEU (Half pallet)
      234708, // 17. EWP (Euro Disposable Pallet)
      234709, // 18. BLOK (Blok pallet)
    ],
    packagingIds: [
      -105,  // C - Open Doos (colli big) - 55_915
      -102,  // C - HEU (Half pallet) - 55_916
      -103,  // C - Oppotten P66-P80 / EWP - 55_917
      -104,  // C - Oppotten P81-P100 / BLOK - 55_962
    ],
  },
]

/**
 * Given a list of picklist tag IDs, returns the matching filter group
 * (first match wins) or null if no filter applies.
 */
export function getTagPackagingFilter(
  tagIds: number[]
): TagPackagingFilterGroup | null {
  if (tagIds.length === 0) return null
  const tagSet = new Set(tagIds)
  return (
    TAG_PACKAGING_FILTERS.find((group) =>
      group.tagIds.some((id) => tagSet.has(id))
    ) ?? null
  )
}
