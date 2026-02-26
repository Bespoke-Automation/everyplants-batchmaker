import { NextRequest, NextResponse } from 'next/server'
import { updatePackaging as picqerUpdatePackaging } from '@/lib/picqer/client'
import { updateLocalPackaging } from '@/lib/supabase/localPackagings'

export const dynamic = 'force-dynamic'

// Fields that exist in Picqer and should be synced there
const PICQER_FIELDS = ['name', 'barcode', 'length', 'width', 'height'] as const

// Fields that only exist in our local Supabase DB (engine-specific)
const ENGINE_FIELDS = ['max_weight', 'box_category', 'specificity_score', 'handling_cost', 'material_cost', 'use_in_auto_advice', 'image_url', 'picqer_tag_name', 'num_shipping_labels', 'facturatie_box_sku'] as const

/**
 * PUT /api/verpakking/packagings/update
 * Update packaging in Picqer (base fields) + local DB (all fields)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { idpackaging, new_idpackaging } = body

    if (!idpackaging) {
      return NextResponse.json(
        { error: 'Missing required field: idpackaging' },
        { status: 400 }
      )
    }

    // Split updates into Picqer-synced fields and engine-only fields
    const picqerUpdates: Record<string, unknown> = {}
    const engineUpdates: Record<string, unknown> = {}

    for (const field of PICQER_FIELDS) {
      if (body[field] !== undefined) picqerUpdates[field] = body[field]
    }

    for (const field of ENGINE_FIELDS) {
      if (body[field] !== undefined) engineUpdates[field] = body[field]
    }

    // If new_idpackaging is provided, include it in local updates
    const allLocalUpdates: Record<string, unknown> = { ...picqerUpdates, ...engineUpdates }
    if (new_idpackaging !== undefined && typeof new_idpackaging === 'number') {
      allLocalUpdates.idpackaging = new_idpackaging
    }

    if (Object.keys(allLocalUpdates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    // Update Picqer-synced fields in Picqer (only if real Picqer ID, not placeholder)
    let updated = null
    if (Object.keys(picqerUpdates).length > 0 && idpackaging > 0) {
      updated = await picqerUpdatePackaging(idpackaging, picqerUpdates as Record<string, string | number | null>)
    }

    // Update all fields in local DB
    await updateLocalPackaging(idpackaging, allLocalUpdates as Record<string, string | number | boolean | null>)

    return NextResponse.json({ packaging: updated })
  } catch (error) {
    console.error('[verpakking] Error updating packaging:', error)
    return NextResponse.json(
      { error: 'Failed to update packaging', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
