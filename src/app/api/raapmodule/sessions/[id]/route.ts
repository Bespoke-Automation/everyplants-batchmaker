import { NextResponse } from 'next/server'
import { completeSession } from '@/lib/supabase/raapSessions'

export const dynamic = 'force-dynamic'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    if (body.status === 'completed') {
      await completeSession(id)
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating session:', error)
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
  }
}
