import { NextResponse } from 'next/server'
import { getPicklistBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

interface PicklistItem {
  batchNumbers: string[]
  productName: string
  productCode: string
  totalAmount: number
  stockLocation: string | null
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { picqerBatchIds } = body as { picqerBatchIds: number[] }

    if (!Array.isArray(picqerBatchIds) || picqerBatchIds.length === 0) {
      return NextResponse.json({ error: 'picqerBatchIds is required and must be a non-empty array' }, { status: 400 })
    }

    const uniqueIds = [...new Set(picqerBatchIds)]

    // Fetch all batches from Picqer
    const batchResults = await Promise.allSettled(
      uniqueIds.map(id => getPicklistBatch(id))
    )

    const errors: string[] = []
    // Aggregate products: key = productcode + stockLocation
    const aggregated = new Map<string, PicklistItem>()

    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i]
      if (result.status === 'rejected') {
        errors.push(`Batch ${uniqueIds[i]}: ${result.reason?.message || 'Unknown error'}`)
        continue
      }

      const batch = result.value
      const batchNumber = batch.picklist_batchid || String(batch.idpicklist_batch)

      if (!batch.products) continue

      for (const product of batch.products) {
        const totalAmount = product.picklists.reduce((sum, pl) => sum + pl.amount, 0)
        const key = `${product.productcode}::${product.stock_location || ''}`

        const existing = aggregated.get(key)
        if (existing) {
          existing.totalAmount += totalAmount
          if (!existing.batchNumbers.includes(batchNumber)) {
            existing.batchNumbers.push(batchNumber)
          }
        } else {
          aggregated.set(key, {
            batchNumbers: [batchNumber],
            productName: product.name,
            productCode: product.productcode,
            totalAmount,
            stockLocation: product.stock_location,
          })
        }
      }
    }

    if (aggregated.size === 0 && errors.length > 0) {
      return NextResponse.json({ error: 'Failed to fetch any batch data', details: errors }, { status: 502 })
    }

    // Sort by stock_location (nulls last), then product name
    const items = Array.from(aggregated.values()).sort((a, b) => {
      if (a.stockLocation && !b.stockLocation) return -1
      if (!a.stockLocation && b.stockLocation) return 1
      if (a.stockLocation && b.stockLocation) {
        const locCompare = a.stockLocation.localeCompare(b.stockLocation)
        if (locCompare !== 0) return locCompare
      }
      return a.productName.localeCompare(b.productName)
    })

    return NextResponse.json({ items, errors: errors.length > 0 ? errors : undefined })
  } catch (error) {
    console.error('Picklist generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
