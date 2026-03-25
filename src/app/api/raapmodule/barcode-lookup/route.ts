import { NextResponse } from 'next/server'
import { searchProducts } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const barcode = searchParams.get('barcode')

  if (!barcode) {
    return NextResponse.json({ error: 'barcode is required' }, { status: 400 })
  }

  try {
    // Picqer search matches against productcode, barcode, and name
    const products = await searchProducts(barcode)
    const match = products.find(p => p.productcode === barcode) || products[0]

    if (match) {
      return NextResponse.json({ productcode: match.productcode, product_id: match.idproduct })
    }
    return NextResponse.json({ productcode: null })
  } catch (error) {
    console.error('Barcode lookup error:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}
