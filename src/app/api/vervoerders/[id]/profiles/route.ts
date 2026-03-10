import { NextRequest, NextResponse } from 'next/server'
import { addShippingProfile, addShippingProfiles } from '@/lib/supabase/vervoerders'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: vervoerderId } = await params
    const body = await request.json()

    // Bulk add: { profiles: [...] }
    if (Array.isArray(body.profiles)) {
      const profiles = body.profiles.filter(
        (p: { shipping_profile_id?: number; profile_name?: string }) =>
          p.shipping_profile_id && p.profile_name
      )
      if (profiles.length === 0) {
        return NextResponse.json(
          { error: 'No valid profiles provided' },
          { status: 400 }
        )
      }
      const result = await addShippingProfiles(vervoerderId, profiles)
      return NextResponse.json({ profiles: result })
    }

    // Single add: { shipping_profile_id, profile_name, carrier }
    const { shipping_profile_id, profile_name, carrier } = body

    if (!shipping_profile_id || !profile_name) {
      return NextResponse.json(
        { error: 'shipping_profile_id and profile_name are required' },
        { status: 400 }
      )
    }

    const profile = await addShippingProfile(vervoerderId, {
      shipping_profile_id,
      profile_name,
      carrier,
    })

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Error adding shipping profile(s):', error)
    const message = error instanceof Error && error.message.includes('unique')
      ? 'Een of meer verzendprofielen zijn al gekoppeld aan deze vervoerder'
      : 'Failed to add shipping profile(s)'
    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && error.message.includes('unique') ? 409 : 500 }
    )
  }
}
