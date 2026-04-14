import { inngest } from '@/inngest/client'
import { supabase } from '@/lib/supabase/client'
import { tryCompleteSession } from '@/lib/verpakking/tryCompleteSession'
import { logActivity } from '@/lib/supabase/activityLog'

const STUCK_THRESHOLD_MINUTES = 5
const MAX_SESSIONS_PER_RUN = 50

interface StuckSession {
  id: string
  picklist_id: number
  picklistid: string
  order_id: number
  assigned_to_name: string | null
  updated_at: string
}

/**
 * Self-healing cron: finds packing sessions where all boxes are shipped but the
 * session itself never transitioned to 'completed'. This can happen if:
 *  - a background `tryCompleteSession` call was killed by the serverless runtime,
 *  - a Picqer API call timed out mid-completion,
 *  - the container crashed between shipment creation and picklist close,
 *  - a future regression reintroduces fire-and-forget patterns.
 *
 * Runs every 10 minutes. Only touches sessions that have been stuck for at least
 * 5 minutes so we don't race the normal ship-all flow.
 */
export const healStuckPackingSessions = inngest.createFunction(
  { id: 'heal-stuck-packing-sessions', retries: 1 },
  { cron: '*/10 * * * *' },
  async ({ step, logger }) => {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString()

    const stuck = await step.run('find-stuck-sessions', async (): Promise<StuckSession[]> => {
      const { data, error } = await supabase
        .schema('batchmaker')
        .from('packing_sessions')
        .select('id,picklist_id,picklistid,order_id,assigned_to_name,updated_at,packing_session_boxes(status)')
        .in('status', ['claimed', 'shipping', 'packing'])
        .lt('updated_at', cutoff)
        .order('updated_at', { ascending: true })
        .limit(MAX_SESSIONS_PER_RUN * 3) // oversample, filter in memory

      if (error) throw new Error(`Query failed: ${error.message}`)
      if (!data) return []

      return data
        .filter((s: { packing_session_boxes: { status: string }[] }) => {
          const boxes = s.packing_session_boxes || []
          return boxes.length > 0 && boxes.every(b =>
            b.status === 'label_fetched' || b.status === 'shipped' || b.status === 'shipment_created'
          )
        })
        .slice(0, MAX_SESSIONS_PER_RUN)
        .map((s): StuckSession => ({
          id: s.id,
          picklist_id: s.picklist_id,
          picklistid: s.picklistid,
          order_id: s.order_id,
          assigned_to_name: s.assigned_to_name,
          updated_at: s.updated_at,
        }))
    })

    if (stuck.length === 0) {
      return { healed: 0, failed: 0, skipped: 0 }
    }

    logger.info(`[heal-stuck] Found ${stuck.length} stuck sessions`)

    // Heal sequentially to respect Picqer rate limits (each session = 2-5 Picqer calls)
    let healed = 0
    let failed = 0
    let skipped = 0

    for (const s of stuck) {
      const result = await step.run(`heal-${s.id}`, async () => {
        try {
          const res = await tryCompleteSession(s.id, s.picklist_id)
          if (res.sessionCompleted) {
            await logActivity({
              action: 'session.auto_healed',
              module: 'verpakkingsmodule',
              description: `Auto-healed stuck session (picklist ${s.picklistid})`,
              metadata: {
                session_id: s.id,
                picklist_id: s.picklist_id,
                order_id: s.order_id,
                stuck_since: s.updated_at,
                warning: res.warning,
              },
            })
            return { outcome: 'healed' as const }
          }
          if (res.productsIncomplete) return { outcome: 'skipped' as const, reason: 'incomplete products' }
          return { outcome: 'skipped' as const, reason: res.warning || 'not completed' }
        } catch (e) {
          logger.error(`[heal-stuck] Failed session ${s.id}:`, e)
          return { outcome: 'failed' as const, error: e instanceof Error ? e.message : 'unknown' }
        }
      })

      if (result.outcome === 'healed') healed++
      else if (result.outcome === 'failed') failed++
      else skipped++
    }

    return { healed, failed, skipped, total: stuck.length }
  },
)
