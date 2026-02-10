import { NextRequest, NextResponse } from 'next/server'
import { pickProduct } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { productcode, amount } = body

    const result = await pickProduct(Number(id), productcode, amount)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[picqer] Error picking product:', error)
    return NextResponse.json(
      { error: 'Failed to pick product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
