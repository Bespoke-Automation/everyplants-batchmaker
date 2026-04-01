import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/comments/resolve
 * Mark a comment as resolved for a worker
 */
export async function POST(request: NextRequest) {
  try {
    const { idcomment, workerId } = await request.json()

    if (!idcomment || !workerId) {
      return NextResponse.json({ error: 'Missing idcomment or workerId' }, { status: 400 })
    }

    const { error } = await supabase
      .schema('batchmaker')
      .from('comment_resolutions')
      .upsert(
        { idcomment, worker_id: workerId, resolved_at: new Date().toISOString() },
        { onConflict: 'idcomment,worker_id' }
      )

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking/comments/resolve] Error:', error)
    return NextResponse.json(
      { error: 'Failed to resolve comment' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/comments/resolve
 * Unresolve a comment for a worker
 */
export async function DELETE(request: NextRequest) {
  try {
    const { idcomment, workerId } = await request.json()

    if (!idcomment || !workerId) {
      return NextResponse.json({ error: 'Missing idcomment or workerId' }, { status: 400 })
    }

    const { error } = await supabase
      .schema('batchmaker')
      .from('comment_resolutions')
      .delete()
      .eq('idcomment', idcomment)
      .eq('worker_id', workerId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking/comments/resolve] Error:', error)
    return NextResponse.json(
      { error: 'Failed to unresolve comment' },
      { status: 500 }
    )
  }
}
