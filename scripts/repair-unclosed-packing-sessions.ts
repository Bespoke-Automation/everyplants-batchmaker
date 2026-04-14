/* eslint-disable no-console */
// Reparatie: sluit picklists + markeer sessies `completed` voor sessies die
// door de ship-all fire-and-forget bug (commit 2a95771, 13 apr 2026) zijn blijven hangen.
//
// Draai eerst in dry-run:
//   npx tsx --env-file=.env.local scripts/repair-unclosed-packing-sessions.ts
//
// Apply met:
//   npx tsx --env-file=.env.local scripts/repair-unclosed-packing-sessions.ts --apply

import { fetchPicklist, pickAllProducts, closePicklist } from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'

const APPLY = process.argv.includes('--apply')

interface Session {
  id: string
  picklist_id: number
  picklistid: string
  order_id: number
  assigned_to_name: string | null
  packing_session_boxes: { id: string; status: string; shipment_id: number | null }[]
}

async function completeSessionLocally(s: Session, note: string) {
  if (!APPLY) {
    console.log(`  [dry-run] Would update Supabase: status=completed, completed_at=now() — ${note}`)
    return
  }
  const { error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completion_warning: note,
    })
    .eq('id', s.id)
  if (error) throw new Error(`Supabase update failed: ${error.message}`)
  console.log(`  ✓ Supabase updated (${note})`)
}

async function main() {
  console.log(`Modus: ${APPLY ? 'APPLY (wijzigingen worden uitgevoerd)' : 'DRY-RUN (geen wijzigingen)'}\n`)

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id,picklist_id,picklistid,order_id,assigned_to_name,packing_session_boxes(id,status,shipment_id)')
    .eq('status', 'claimed')
    .gte('created_at', '2026-04-12')

  if (error) throw error
  const sessions = (data || []) as Session[]

  const candidates = sessions.filter(s => {
    const boxes = s.packing_session_boxes || []
    return boxes.length > 0 && boxes.every(b =>
      b.status === 'label_fetched' || b.status === 'shipped' || b.status === 'shipment_created'
    )
  })

  console.log(`Kandidaten: ${candidates.length}\n`)

  let localOnlyOk = 0
  let pickAllCloseOk = 0
  let closeOnlyOk = 0
  let failed = 0

  for (const s of candidates) {
    console.log(`▸ ${s.picklistid.padEnd(15)} order=${s.order_id} worker=${s.assigned_to_name || '?'}`)
    try {
      const picklist = await fetchPicklist(s.picklist_id)
      const status = picklist.status
      const totalProducts = picklist.totalproducts
      const totalPicked = picklist.totalpicked
      console.log(`  picqer: status=${status}, picked=${totalPicked}/${totalProducts}`)

      if (status === 'closed' || status === 'completed') {
        await completeSessionLocally(s, 'Auto-repair: picklist was already closed in Picqer')
        localOnlyOk++
        continue
      }

      if (totalPicked < totalProducts) {
        if (!APPLY) {
          console.log(`  [dry-run] Would call pickAllProducts(${s.picklist_id})`)
        } else {
          const pickResult = await pickAllProducts(s.picklist_id)
          if (!pickResult.success) throw new Error(`pickAllProducts: ${pickResult.error}`)
          console.log(`  ✓ pickAllProducts done`)
        }
      }

      if (!APPLY) {
        console.log(`  [dry-run] Would call closePicklist(${s.picklist_id})`)
        await completeSessionLocally(s, 'Auto-repair: picklist closed by repair script')
      } else {
        const closeResult = await closePicklist(s.picklist_id)
        if (!closeResult.success) throw new Error(`closePicklist: ${closeResult.error}`)
        console.log(`  ✓ closePicklist done`)
        await completeSessionLocally(s, 'Auto-repair: picklist closed by repair script')
      }

      if (totalPicked < totalProducts) pickAllCloseOk++
      else closeOnlyOk++
    } catch (e) {
      failed++
      const msg = e instanceof Error ? e.message : 'unknown'
      console.log(`  ✗ FAIL: ${msg}`)
    }
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`SAMENVATTING (${APPLY ? 'APPLIED' : 'dry-run'}):`)
  console.log(`  Alleen Supabase geüpdatet (al gesloten): ${localOnlyOk}`)
  console.log(`  pickAll + close + Supabase:              ${pickAllCloseOk}`)
  console.log(`  close + Supabase:                        ${closeOnlyOk}`)
  console.log(`  Mislukt:                                 ${failed}`)
  console.log(`  Totaal:                                  ${localOnlyOk + pickAllCloseOk + closeOnlyOk + failed}`)
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e); process.exit(1) })
