import { NextRequest, NextResponse } from 'next/server'
import { assignProduct, updateProductAssignment, removeProduct, getPackingSession } from '@/lib/supabase/packingSessions'
import { pickProduct, fetchPicklist } from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sessions/[id]/products
 * Assigns a product to a box in the session
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    const body = await request.json()
    const { boxId, picqerProductId, productcode, productName, amount, weightPerUnit } = body

    if (!boxId || !picqerProductId || !productcode || !productName || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: boxId, picqerProductId, productcode, productName, amount' },
        { status: 400 }
      )
    }

    // B4: Validate product belongs to this picklist
    const session = await getPackingSession(sessionId)
    const picklist = await fetchPicklist(session.picklist_id)
    const picklistProduct = picklist.products.find(p => p.idproduct === picqerProductId)

    if (!picklistProduct) {
      return NextResponse.json(
        { error: 'Product niet gevonden in picklist' },
        { status: 400 }
      )
    }

    const product = await assignProduct({
      session_id: sessionId,
      box_id: boxId,
      picqer_product_id: picqerProductId,
      productcode,
      product_name: productName,
      amount,
      weight_per_unit: weightPerUnit,
    })

    // Mark product as picked in Picqer (non-blocking — don't fail if Picqer is down)
    let picqerWarning: string | undefined
    const amountToPick = Math.min(amount, picklistProduct.amount - picklistProduct.amount_picked)
    if (amountToPick > 0) {
      try {
        await pickProduct(session.picklist_id, picklistProduct.idpicklist_product, amountToPick)
      } catch (pickError) {
        console.error('[verpakking] Failed to pick product in Picqer:', pickError)
        picqerWarning = `Product assigned but Picqer pick failed: ${pickError instanceof Error ? pickError.message : 'Unknown error'}. Please pick manually in Picqer.`
      }
    }

    return NextResponse.json({ ...product, warning: picqerWarning })
  } catch (error) {
    console.error('[verpakking] Error assigning product:', error)
    return NextResponse.json(
      { error: 'Failed to assign product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/sessions/[id]/products
 * Updates a product assignment (move to different box or change amount)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params // acknowledge route param
    const body = await request.json()
    const { productId, boxId, amount } = body

    if (!productId) {
      return NextResponse.json(
        { error: 'Missing required field: productId' },
        { status: 400 }
      )
    }

    const updates: { box_id?: string; amount?: number } = {}
    if (boxId !== undefined) updates.box_id = boxId
    if (amount !== undefined) updates.amount = amount

    const updatedProduct = await updateProductAssignment(productId, updates)

    return NextResponse.json(updatedProduct)
  } catch (error) {
    console.error('[verpakking] Error updating product assignment:', error)
    return NextResponse.json(
      { error: 'Failed to update product assignment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/sessions/[id]/products
 * Removes a product assignment and unpicks in Picqer
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    const body = await request.json()
    const { productId } = body

    if (!productId) {
      return NextResponse.json(
        { error: 'Missing required field: productId' },
        { status: 400 }
      )
    }

    // Fetch the product record before deleting so we know what to unpick
    const { data: productRecord } = await supabase
      .schema('batchmaker')
      .from('packing_session_products')
      .select('picqer_product_id, amount, session_id')
      .eq('id', productId)
      .single()

    const session = await getPackingSession(sessionId)

    await removeProduct(productId)

    // Unpick in Picqer (non-blocking — send negative amount)
    let picqerWarning: string | undefined
    if (productRecord && productRecord.amount > 0) {
      try {
        const picklist = await fetchPicklist(session.picklist_id)
        const picklistProduct = picklist.products.find(
          (p) => p.idproduct === productRecord.picqer_product_id
        )

        if (picklistProduct && picklistProduct.amount_picked > 0) {
          const amountToUnpick = Math.min(productRecord.amount, picklistProduct.amount_picked)
          await pickProduct(session.picklist_id, picklistProduct.idpicklist_product, -amountToUnpick)
        }
      } catch (unpickError) {
        console.error('[verpakking] Failed to unpick product in Picqer:', unpickError)
        picqerWarning = `Product removed but Picqer unpick failed: ${unpickError instanceof Error ? unpickError.message : 'Unknown error'}`
      }
    }

    return NextResponse.json({ success: true, warning: picqerWarning })
  } catch (error) {
    console.error('[verpakking] Error removing product:', error)
    return NextResponse.json(
      { error: 'Failed to remove product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
