import { NextResponse } from 'next/server'
import { deleteVervoerder } from '@/lib/supabase/vervoerders'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteVervoerder(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting vervoerder:', error)
    return NextResponse.json(
      { error: 'Failed to delete vervoerder' },
      { status: 500 }
    )
  }
}
