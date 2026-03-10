import { NextResponse } from 'next/server'
import { getAllShippingProviders } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const profiles = await getAllShippingProviders()
    return NextResponse.json({ profiles })
  } catch (error) {
    console.error('Error fetching shipping providers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping providers' },
      { status: 500 }
    )
  }
}
