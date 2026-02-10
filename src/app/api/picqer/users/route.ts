import { NextResponse } from 'next/server'
import { getUsers } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const users = await getUsers()

    return NextResponse.json({
      users,
      total: users.length,
    })
  } catch (error) {
    console.error('[picqer] Error fetching users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
