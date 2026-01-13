import { NextResponse } from 'next/server'
import { getPackagings } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const packagings = await getPackagings()

    return NextResponse.json({
      packagings,
      total: packagings.length,
    })
  } catch (error) {
    console.error('Error fetching packagings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packagings', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
