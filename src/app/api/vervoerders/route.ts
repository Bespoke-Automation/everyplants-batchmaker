import { NextRequest, NextResponse } from 'next/server'
import { getVervoerders, createVervoerder } from '@/lib/supabase/vervoerders'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const vervoerders = await getVervoerders()
    return NextResponse.json({ vervoerders })
  } catch (error) {
    console.error('Error fetching vervoerders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vervoerders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json()

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    const vervoerder = await createVervoerder(name.trim())
    return NextResponse.json({ vervoerder })
  } catch (error) {
    console.error('Error creating vervoerder:', error)
    const message = error instanceof Error && error.message.includes('unique')
      ? 'Een vervoerder met deze naam bestaat al'
      : 'Failed to create vervoerder'
    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && error.message.includes('unique') ? 409 : 500 }
    )
  }
}
