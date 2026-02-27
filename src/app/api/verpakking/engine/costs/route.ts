import { NextRequest, NextResponse } from 'next/server'
import { getAllCostsForCountry } from '@/lib/engine/costProvider'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/engine/costs?country=NL
 * Returns cost data for all packagings for a given country.
 * For each box_sku, picks the cheapest entry (NULL weight bracket or lowest bracket).
 *
 * Response: { costs: Record<string, { total_cost: number, carrier_code: string }> }
 */
export async function GET(request: NextRequest) {
  try {
    const country = request.nextUrl.searchParams.get('country') || 'NL'

    const costMap = await getAllCostsForCountry(country.toUpperCase())

    if (costMap === null) {
      return NextResponse.json(
        { error: 'Cost data unavailable (facturatie database unreachable)' },
        { status: 503 }
      )
    }

    // For each SKU, pick the cheapest entry (prefer NULL weight bracket, then lowest total_cost)
    const costs: Record<string, { total_cost: number; carrier_code: string }> = {}

    for (const [boxSku, entries] of costMap) {
      if (entries.length === 0) continue

      // Prefer NULL weight bracket (parcel-only), then cheapest
      const nullBracket = entries.filter(e => e.weightBracket === null)
      const best = nullBracket.length > 0
        ? nullBracket.reduce((a, b) => a.totalCost <= b.totalCost ? a : b)
        : entries.reduce((a, b) => a.totalCost <= b.totalCost ? a : b)

      costs[boxSku] = {
        total_cost: best.totalCost,
        carrier_code: best.carrier,
      }
    }

    return NextResponse.json({ costs })
  } catch (error) {
    console.error('[engine/costs] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch costs' },
      { status: 500 }
    )
  }
}
