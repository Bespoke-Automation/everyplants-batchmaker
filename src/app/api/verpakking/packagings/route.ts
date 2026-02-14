import { NextRequest, NextResponse } from 'next/server'
import { getLocalPackagings, getActiveLocalPackagings } from '@/lib/supabase/localPackagings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/packagings?active=true
 * Returns local packagings, optionally filtered by active status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'

    const packagings = activeOnly
      ? await getActiveLocalPackagings()
      : await getLocalPackagings()

    return NextResponse.json({
      packagings,
      total: packagings.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching local packagings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packagings', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
