import { NextRequest, NextResponse } from 'next/server'
import { getAllCostsForCountry } from '@/lib/engine/costProvider'
import type { CostEntry } from '@/lib/engine/costProvider'

export const dynamic = 'force-dynamic'

type CostSummary = { total_cost: number; carrier_code: string }

function pickCheapest(entries: CostEntry[]): CostSummary | null {
  if (entries.length === 0) return null
  const nullBracket = entries.filter(e => e.weightBracket === null)
  const best = nullBracket.length > 0
    ? nullBracket.reduce((a, b) => a.totalCost <= b.totalCost ? a : b)
    : entries.reduce((a, b) => a.totalCost <= b.totalCost ? a : b)
  return { total_cost: best.totalCost, carrier_code: best.carrier }
}

/**
 * GET /api/verpakking/engine/costs?countries=NL,DE,FR,BE
 * GET /api/verpakking/engine/costs?country=NL  (backwards compatible)
 *
 * Single country: { costs: Record<sku, CostSummary> }
 * Multiple countries: { costs: Record<country, Record<sku, CostSummary>> }
 */
export async function GET(request: NextRequest) {
  try {
    const countriesParam = request.nextUrl.searchParams.get('countries')
    const singleCountry = request.nextUrl.searchParams.get('country')

    // Multi-country mode
    if (countriesParam) {
      const countries = countriesParam.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
      const result: Record<string, Record<string, CostSummary>> = {}

      const maps = await Promise.all(countries.map(c => getAllCostsForCountry(c)))

      let anyAvailable = false
      for (let i = 0; i < countries.length; i++) {
        const costMap = maps[i]
        if (costMap === null) continue
        anyAvailable = true

        const countryCosts: Record<string, CostSummary> = {}
        for (const [boxSku, entries] of costMap) {
          const best = pickCheapest(entries)
          if (best) countryCosts[boxSku] = best
        }
        result[countries[i]] = countryCosts
      }

      if (!anyAvailable) {
        return NextResponse.json(
          { error: 'Cost data unavailable (facturatie database unreachable)' },
          { status: 503 }
        )
      }

      return NextResponse.json({ costs: result })
    }

    // Single country mode (backwards compatible)
    const country = (singleCountry || 'NL').toUpperCase()
    const costMap = await getAllCostsForCountry(country)

    if (costMap === null) {
      return NextResponse.json(
        { error: 'Cost data unavailable (facturatie database unreachable)' },
        { status: 503 }
      )
    }

    const costs: Record<string, CostSummary> = {}
    for (const [boxSku, entries] of costMap) {
      const best = pickCheapest(entries)
      if (best) costs[boxSku] = best
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
