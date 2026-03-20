import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface BoxCapacityRow {
  id: string
  packaging_id: string
  shipping_unit_id: string
  max_quantity: number
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined fields
  packaging_name?: string
  shipping_unit_name?: string
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get all active box capacities with packaging and shipping unit names joined
 */
export async function getBoxCapacities(): Promise<BoxCapacityRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('box_capacities')
    .select(`
      *,
      packagings!box_capacities_packaging_id_fkey ( name ),
      shipping_units!box_capacities_shipping_unit_id_fkey ( name )
    `)
    .eq('is_active', true)
    .order('packaging_id', { ascending: true })
    .order('shipping_unit_id', { ascending: true })

  if (error) {
    console.error('Error fetching box capacities:', error)
    throw error
  }

  // Flatten the joined data
  return (data || []).map((row: Record<string, unknown>) => {
    const packaging = row.packagings as { name: string } | null
    const shippingUnit = row.shipping_units as { name: string } | null
    return {
      id: row.id as string,
      packaging_id: row.packaging_id as string,
      shipping_unit_id: row.shipping_unit_id as string,
      max_quantity: row.max_quantity as number,
      is_active: row.is_active as boolean,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      packaging_name: packaging?.name ?? undefined,
      shipping_unit_name: shippingUnit?.name ?? undefined,
    }
  })
}

/**
 * Returns a nested map: Map<packagingId, Map<shippingUnitId, maxQuantity>>
 * Used by the packaging optimizer to quickly look up capacities.
 * Cached for 1 minute to avoid repeated DB queries within the same request cycle.
 */
let _capacitiesCache: Map<string, Map<string, number>> | null = null
let _capacitiesCacheTime = 0
const CACHE_TTL = 60_000

export async function getBoxCapacitiesMap(): Promise<Map<string, Map<string, number>>> {
  if (_capacitiesCache && Date.now() - _capacitiesCacheTime < CACHE_TTL) {
    return _capacitiesCache
  }

  const capacities = await getBoxCapacities()

  const map = new Map<string, Map<string, number>>()

  for (const cap of capacities) {
    if (!map.has(cap.packaging_id)) {
      map.set(cap.packaging_id, new Map())
    }
    map.get(cap.packaging_id)!.set(cap.shipping_unit_id, cap.max_quantity)
  }

  _capacitiesCache = map
  _capacitiesCacheTime = Date.now()
  return map
}

// ── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Insert or update a box capacity.
 * Uses the unique constraint on (packaging_id, shipping_unit_id) for upsert.
 */
export async function upsertBoxCapacity(
  packagingId: string,
  shippingUnitId: string,
  maxQuantity: number
): Promise<BoxCapacityRow> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('box_capacities')
    .upsert(
      {
        packaging_id: packagingId,
        shipping_unit_id: shippingUnitId,
        max_quantity: maxQuantity,
        is_active: true,
      },
      { onConflict: 'packaging_id,shipping_unit_id' }
    )
    .select(`
      *,
      packagings!box_capacities_packaging_id_fkey ( name ),
      shipping_units!box_capacities_shipping_unit_id_fkey ( name )
    `)
    .single()

  if (error) {
    console.error('Error upserting box capacity:', error)
    throw error
  }

  const packaging = (data as Record<string, unknown>).packagings as { name: string } | null
  const shippingUnit = (data as Record<string, unknown>).shipping_units as { name: string } | null

  return {
    ...data,
    packaging_name: packaging?.name ?? undefined,
    shipping_unit_name: shippingUnit?.name ?? undefined,
  } as BoxCapacityRow
}

// ── Delete (soft) ────────────────────────────────────────────────────────────

/**
 * Soft-delete a box capacity by setting is_active = false
 */
export async function deleteBoxCapacity(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('box_capacities')
    .update({ is_active: false })
    .eq('id', id)

  if (error) {
    console.error('Error deleting box capacity:', error)
    throw error
  }
}
