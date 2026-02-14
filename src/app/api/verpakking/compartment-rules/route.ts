import { NextRequest, NextResponse } from 'next/server'
import {
  getCompartmentRules,
  createCompartmentRule,
  updateCompartmentRule,
  deleteCompartmentRule,
} from '@/lib/supabase/compartmentRules'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/compartment-rules?packaging_id=uuid
 * Returns all compartment rules, optionally filtered by packaging_id
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const packagingId = searchParams.get('packaging_id') || undefined

    const rules = await getCompartmentRules(packagingId)

    return NextResponse.json({
      rules,
      total: rules.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching compartment rules:', error)
    return NextResponse.json(
      { error: 'Failed to fetch compartment rules', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/compartment-rules
 * Creates a new compartment rule
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { packagingId, ruleGroup, shippingUnitId, quantity, operator, alternativeForId, sortOrder } = body

    if (!packagingId || ruleGroup === undefined || !shippingUnitId) {
      return NextResponse.json(
        { error: 'Verplichte velden: packagingId, ruleGroup, shippingUnitId' },
        { status: 400 }
      )
    }

    const rule = await createCompartmentRule({
      packaging_id: packagingId,
      rule_group: ruleGroup,
      shipping_unit_id: shippingUnitId,
      quantity: quantity ?? 1,
      operator: operator ?? 'EN',
      alternative_for_id: alternativeForId ?? null,
      sort_order: sortOrder ?? 0,
    })

    return NextResponse.json({ rule })
  } catch (error) {
    console.error('[verpakking] Error creating compartment rule:', error)
    return NextResponse.json(
      { error: 'Failed to create compartment rule', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/compartment-rules
 * Updates an existing compartment rule
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Verplicht veld: id' },
        { status: 400 }
      )
    }

    // Convert camelCase body keys to snake_case for Supabase
    const snakeCaseUpdates: Record<string, unknown> = {}
    if (updates.quantity !== undefined) snakeCaseUpdates.quantity = updates.quantity
    if (updates.operator !== undefined) snakeCaseUpdates.operator = updates.operator
    if (updates.isActive !== undefined) snakeCaseUpdates.is_active = updates.isActive
    if (updates.sortOrder !== undefined) snakeCaseUpdates.sort_order = updates.sortOrder
    if (updates.shippingUnitId !== undefined) snakeCaseUpdates.shipping_unit_id = updates.shippingUnitId
    if (updates.alternativeForId !== undefined) snakeCaseUpdates.alternative_for_id = updates.alternativeForId

    const rule = await updateCompartmentRule(id, snakeCaseUpdates)

    return NextResponse.json({ rule })
  } catch (error) {
    console.error('[verpakking] Error updating compartment rule:', error)
    return NextResponse.json(
      { error: 'Failed to update compartment rule', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/compartment-rules
 * Deletes a compartment rule
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Verplicht veld: id' },
        { status: 400 }
      )
    }

    await deleteCompartmentRule(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking] Error deleting compartment rule:', error)
    return NextResponse.json(
      { error: 'Failed to delete compartment rule', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
