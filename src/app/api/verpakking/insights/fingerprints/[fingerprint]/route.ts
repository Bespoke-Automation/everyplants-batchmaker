import { NextRequest, NextResponse } from 'next/server'
import { getFingerprintDetail } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/fingerprints/[fingerprint]?country=NL
 * Drill-down for a single fingerprint. The `country` query param is needed
 * to disambiguate legacy fingerprints that lack a country prefix but are
 * grouped per-country in the library view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  try {
    const { fingerprint } = await params
    const decoded = decodeURIComponent(fingerprint)
    const country = request.nextUrl.searchParams.get('country')
    const detail = await getFingerprintDetail(decoded, country)

    if (!detail) {
      return NextResponse.json(
        { error: 'Fingerprint niet gevonden', fingerprint: decoded },
        { status: 404 },
      )
    }

    return NextResponse.json(detail)
  } catch (error) {
    console.error('[insights/fingerprints/[fingerprint]] error:', error)
    return NextResponse.json(
      {
        error: 'Fingerprint detail ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
