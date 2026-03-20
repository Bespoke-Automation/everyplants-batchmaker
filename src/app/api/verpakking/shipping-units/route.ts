import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getActiveShippingUnitsWithCounts } from '@/lib/supabase/shippingUnits'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/shipping-units
 * Returns all active shipping units with product counts ordered by product_type, sort_order
 */
export async function GET() {
  try {
    const shippingUnits = await getActiveShippingUnitsWithCounts()

    return NextResponse.json({
      shippingUnits,
      total: shippingUnits.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching shipping units:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping units', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/shipping-units
 * Create a new shipping unit
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, product_type, pot_size_min, pot_size_max, height_min, height_max, is_fragile_filter, sort_order } = body

    if (!name || !product_type) {
      return NextResponse.json({ error: 'name en product_type zijn verplicht' }, { status: 400 })
    }

    const { data, error } = await supabase
      .schema('batchmaker')
      .from('shipping_units')
      .insert({
        name,
        product_type,
        pot_size_min: pot_size_min ?? null,
        pot_size_max: pot_size_max ?? null,
        height_min: height_min ?? null,
        height_max: height_max ?? null,
        is_fragile_filter: is_fragile_filter ?? null,
        sort_order: sort_order ?? 0,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('[shipping-units] Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('[shipping-units] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/shipping-units
 * Update an existing shipping unit
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, product_type, pot_size_min, pot_size_max, height_min, height_max, is_fragile_filter, sort_order } = body

    if (!id) {
      return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
    }

    const updateFields: Record<string, unknown> = {}
    if (name !== undefined) updateFields.name = name
    if (product_type !== undefined) updateFields.product_type = product_type
    if (pot_size_min !== undefined) updateFields.pot_size_min = pot_size_min
    if (pot_size_max !== undefined) updateFields.pot_size_max = pot_size_max
    if (height_min !== undefined) updateFields.height_min = height_min
    if (height_max !== undefined) updateFields.height_max = height_max
    if (is_fragile_filter !== undefined) updateFields.is_fragile_filter = is_fragile_filter
    if (sort_order !== undefined) updateFields.sort_order = sort_order

    const { data, error } = await supabase
      .schema('batchmaker')
      .from('shipping_units')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[shipping-units] Update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[shipping-units] PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/shipping-units
 * Soft-delete by setting is_active = false
 */
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'id is verplicht' }, { status: 400 })
    }

    // Check if any products are assigned to this unit
    const { count } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('id', { count: 'exact', head: true })
      .eq('shipping_unit_id', id)

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Kan niet verwijderen: ${count} product(en) zijn gekoppeld aan deze verzendeenheid. Verwijder eerst de koppelingen.` },
        { status: 409 }
      )
    }

    const { error } = await supabase
      .schema('batchmaker')
      .from('shipping_units')
      .update({ is_active: false })
      .eq('id', id)

    if (error) {
      console.error('[shipping-units] Delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[shipping-units] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
