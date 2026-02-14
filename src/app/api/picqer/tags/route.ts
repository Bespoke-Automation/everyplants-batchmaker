import { NextResponse } from 'next/server'
import { getTags } from '@/lib/picqer/client'

export async function GET() {
  try {
    const tags = await getTags()
    return NextResponse.json({ tags })
  } catch (error) {
    console.error('Error fetching tags:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    )
  }
}
