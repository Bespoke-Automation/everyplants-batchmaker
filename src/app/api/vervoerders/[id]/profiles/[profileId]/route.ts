import { NextResponse } from 'next/server'
import { removeShippingProfile } from '@/lib/supabase/vervoerders'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; profileId: string }> }
) {
  try {
    const { profileId } = await params
    await removeShippingProfile(profileId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing shipping profile:', error)
    return NextResponse.json(
      { error: 'Failed to remove shipping profile' },
      { status: 500 }
    )
  }
}
