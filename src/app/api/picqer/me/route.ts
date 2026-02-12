import { NextResponse } from 'next/server'
import { getMe } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/me
 * Get the authenticated Picqer API user
 */
export async function GET() {
  try {
    const user = await getMe()

    return NextResponse.json({
      iduser: user.iduser,
      fullName: `${user.firstname} ${user.lastname}`.trim(),
    })
  } catch (error) {
    console.error('[picqer] Error fetching authenticated user:', error)
    return NextResponse.json(
      { error: 'Failed to fetch authenticated user', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
