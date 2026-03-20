import { NextResponse } from 'next/server'
import { getCompartmentRules } from '@/lib/supabase/compartmentRules'
import { upsertBoxCapacity } from '@/lib/supabase/boxCapacities'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/box-capacities/seed
 *
 * Reads all compartment rules and derives max capacities per (packaging, shipping_unit) pair.
 * For each unique combination, takes the MAX quantity across all rule groups and upserts
 * into box_capacities.
 */
export async function POST() {
  try {
    // 1. Fetch all active compartment rules
    const rules = await getCompartmentRules()

    if (rules.length === 0) {
      return NextResponse.json({
        message: 'No compartment rules found, nothing to seed',
        seeded: 0,
      })
    }

    // 2. For each (packaging_id, shipping_unit_id) pair, find the max quantity
    const maxMap = new Map<string, { packagingId: string; shippingUnitId: string; maxQuantity: number; packagingName?: string; shippingUnitName?: string }>()

    for (const rule of rules) {
      if (!rule.is_active) continue

      const key = `${rule.packaging_id}::${rule.shipping_unit_id}`
      const existing = maxMap.get(key)

      if (!existing || rule.quantity > existing.maxQuantity) {
        maxMap.set(key, {
          packagingId: rule.packaging_id,
          shippingUnitId: rule.shipping_unit_id,
          maxQuantity: rule.quantity,
          packagingName: rule.packaging_name,
          shippingUnitName: rule.shipping_unit_name,
        })
      }
    }

    // 3. Upsert each derived capacity
    const results: Array<{
      packagingName: string
      shippingUnitName: string
      maxQuantity: number
      status: 'ok' | 'error'
      error?: string
    }> = []

    for (const entry of maxMap.values()) {
      try {
        await upsertBoxCapacity(entry.packagingId, entry.shippingUnitId, entry.maxQuantity)
        results.push({
          packagingName: entry.packagingName ?? entry.packagingId,
          shippingUnitName: entry.shippingUnitName ?? entry.shippingUnitId,
          maxQuantity: entry.maxQuantity,
          status: 'ok',
        })
      } catch (error) {
        results.push({
          packagingName: entry.packagingName ?? entry.packagingId,
          shippingUnitName: entry.shippingUnitName ?? entry.shippingUnitId,
          maxQuantity: entry.maxQuantity,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const succeeded = results.filter((r) => r.status === 'ok').length
    const failed = results.filter((r) => r.status === 'error').length

    return NextResponse.json({
      message: `Seeded ${succeeded} box capacities from ${rules.length} compartment rules`,
      seeded: succeeded,
      failed,
      rulesProcessed: rules.length,
      uniqueCombinations: maxMap.size,
      details: results,
    })
  } catch (error) {
    console.error('[verpakking] Error seeding box capacities:', error)
    return NextResponse.json(
      { error: 'Failed to seed box capacities', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
