/* eslint-disable no-console */
// Dry-run: check live Picqer status voor alle niet-afgesloten sessies sinds 12 april
// Geen wijzigingen — alleen rapporteren.

import { fetchPicklist } from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'

async function main() {
  const { data: sessions, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id,picklist_id,picklistid,order_id,assigned_to_name,updated_at,packing_session_boxes(id,status,shipment_id)')
    .eq('status', 'claimed')
    .gte('created_at', '2026-04-12')

  if (error) throw error
  if (!sessions) return

  // Filter in JS: alle boxes verzonden
  const candidates = sessions.filter(s => {
    const boxes = s.packing_session_boxes || []
    return boxes.length > 0 && boxes.every(b =>
      b.status === 'label_fetched' || b.status === 'shipped' || b.status === 'shipment_created'
    )
  })

  console.log(`Kandidaten voor reparatie: ${candidates.length}`)
  console.log('─'.repeat(120))

  const needsPickAll: typeof candidates = []
  const needsClose: typeof candidates = []
  const alreadyClosed: typeof candidates = []
  const errors: { session: typeof candidates[0]; error: string }[] = []

  // Sequential to respect Picqer rate limit (client zelf rate-limits ook)
  for (const s of candidates) {
    try {
      const picklist = await fetchPicklist(s.picklist_id)
      const status = picklist.status
      const totalProducts = picklist.totalproducts
      const totalPicked = picklist.totalpicked

      const boxes = s.packing_session_boxes || []
      const labelFetched = boxes.filter(b => b.status === 'label_fetched').length

      console.log(
        `${s.picklistid.padEnd(15)} order=${String(s.order_id).padEnd(10)} ` +
        `worker=${(s.assigned_to_name || '?').padEnd(22)} ` +
        `picqer=${status.padEnd(12)} picked=${totalPicked}/${totalProducts} boxes=${labelFetched}/${boxes.length}`,
      )

      if (status === 'closed' || status === 'completed') {
        alreadyClosed.push(s)
      } else if (totalPicked < totalProducts) {
        needsPickAll.push(s)
      } else {
        needsClose.push(s)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      console.log(`${s.picklistid.padEnd(15)} order=${s.order_id}  ERROR: ${msg}`)
      errors.push({ session: s, error: msg })
    }
  }

  console.log('─'.repeat(120))
  console.log(`SAMENVATTING:`)
  console.log(`  Al gesloten in Picqer (geen actie nodig): ${alreadyClosed.length}`)
  console.log(`  pickAllProducts + closePicklist nodig:    ${needsPickAll.length}`)
  console.log(`  Alleen closePicklist nodig:               ${needsClose.length}`)
  console.log(`  Fouten (handmatig bekijken):              ${errors.length}`)
  console.log('')
  console.log(`Totaal te repareren: ${needsPickAll.length + needsClose.length}`)

  if (alreadyClosed.length > 0) {
    console.log('')
    console.log('Sessies met picklist al gesloten (alleen session.status updaten):')
    for (const s of alreadyClosed) {
      console.log(`  ${s.picklistid} — order ${s.order_id}`)
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
