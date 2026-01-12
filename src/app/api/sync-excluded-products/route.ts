import { NextResponse } from 'next/server'
import { fetchProductsByTag } from '@/lib/picqer/client'
import { EXCLUDED_PRODUCT_TAG } from '@/lib/picqer/types'
import { createClient } from '@supabase/supabase-js'

// Use service role for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST() {
  try {
    console.log('Starting excluded products sync...')

    // Fetch products with "Overig" tag from Picqer
    const picqerProducts = await fetchProductsByTag(EXCLUDED_PRODUCT_TAG)

    // Get existing products from database
    const { data: existingProducts, error: fetchError } = await supabase
      .schema('batchmaker')
      .from('excluded_products')
      .select('id, picqer_product_id')

    if (fetchError) {
      console.error('Error fetching existing excluded products:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch existing products' }, { status: 500 })
    }

    const existingIds = new Set(existingProducts?.map(p => p.picqer_product_id) || [])
    const picqerIds = new Set(picqerProducts.map(p => p.idproduct))

    // Find products to add (in Picqer but not in DB)
    const productsToAdd = picqerProducts.filter(p => !existingIds.has(p.idproduct))

    // Find products to remove (in DB but not in Picqer)
    const productsToRemove = existingProducts?.filter(p => !picqerIds.has(p.picqer_product_id)) || []

    // Add new products
    if (productsToAdd.length > 0) {
      const { error: insertError } = await supabase
        .schema('batchmaker')
        .from('excluded_products')
        .insert(
          productsToAdd.map(p => ({
            picqer_product_id: p.idproduct,
            productcode: p.productcode,
            name: p.name,
            last_synced_at: new Date().toISOString(),
          }))
        )

      if (insertError) {
        console.error('Error inserting excluded products:', insertError)
        return NextResponse.json({ error: 'Failed to insert products' }, { status: 500 })
      }

      console.log(`Added ${productsToAdd.length} new excluded products`)
    }

    // Remove products that no longer have the tag
    if (productsToRemove.length > 0) {
      const idsToRemove = productsToRemove.map(p => p.id)
      const { error: deleteError } = await supabase
        .schema('batchmaker')
        .from('excluded_products')
        .delete()
        .in('id', idsToRemove)

      if (deleteError) {
        console.error('Error deleting excluded products:', deleteError)
        return NextResponse.json({ error: 'Failed to delete products' }, { status: 500 })
      }

      console.log(`Removed ${productsToRemove.length} excluded products`)
    }

    // Update last_synced_at for existing products
    const existingToUpdate = existingProducts?.filter(p => picqerIds.has(p.picqer_product_id)) || []
    if (existingToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .schema('batchmaker')
        .from('excluded_products')
        .update({ last_synced_at: new Date().toISOString() })
        .in('id', existingToUpdate.map(p => p.id))

      if (updateError) {
        console.error('Error updating excluded products:', updateError)
      }
    }

    return NextResponse.json({
      success: true,
      added: productsToAdd.length,
      removed: productsToRemove.length,
      total: picqerProducts.length,
    })
  } catch (error) {
    console.error('Sync excluded products error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('excluded_products')
      .select('id, picqer_product_id, productcode, name, last_synced_at')
      .order('productcode', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch excluded products' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Get excluded products error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
