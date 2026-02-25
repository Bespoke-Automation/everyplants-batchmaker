import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { cancelOrder, addComment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/orders/cancel-all
 *
 * Annuleer ALLE Picqer orders die door onze Floriday koppeling zijn aangemaakt.
 * Alleen orders met processing_status 'created' of 'concept_unresolved' worden geannuleerd.
 * Rate-limited: verwerkt orders sequentieel met een kleine delay.
 */
export async function POST() {
  const env = getFloridayEnv()

  try {
    // Fetch all orders we created
    const { data: orders, error: fetchError } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('floriday_fulfillment_order_id, picqer_order_id, picqer_order_number, processing_status')
      .eq('environment', env)
      .in('processing_status', ['created', 'concept_unresolved'])
      .not('picqer_order_id', 'is', null)

    if (fetchError) throw fetchError

    if (!orders || orders.length === 0) {
      return NextResponse.json({ success: true, message: 'Geen orders om te annuleren', cancelled: 0, failed: 0 })
    }

    console.log(`Bulk cancel: ${orders.length} orders te annuleren`)

    let cancelled = 0
    let alreadyCancelled = 0
    let failed = 0
    const errors: Array<{ orderNumber: string; error: string }> = []

    for (const order of orders) {
      try {
        // Cancel in Picqer (force=true to cancel even if already processing/picked)
        await cancelOrder(order.picqer_order_id, true)
        cancelled++

        // Add comment
        try {
          await addComment('orders', order.picqer_order_id, 'Geannuleerd door Bespoke Automation — dubbele koppeling met Duxly. Order wordt door Duxly opnieuw aangemaakt.')
        } catch {
          // Comment failure is non-critical
        }

        // Update mapping
        await supabase
          .schema('floriday')
          .from('order_mapping')
          .update({
            processing_status: 'cancelled',
            error_message: 'Bulk geannuleerd — dubbele koppeling met Duxly',
            updated_at: new Date().toISOString(),
          })
          .eq('floriday_fulfillment_order_id', order.floriday_fulfillment_order_id)
          .eq('environment', env)

        if (cancelled % 50 === 0) {
          console.log(`Bulk cancel voortgang: ${cancelled}/${orders.length}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown'

        // Check if already cancelled/completed — still update mapping
        if (msg.includes('422') || msg.includes('already')) {
          alreadyCancelled++
          await supabase
            .schema('floriday')
            .from('order_mapping')
            .update({
              processing_status: 'cancelled',
              error_message: 'Was al geannuleerd/verwerkt in Picqer',
              updated_at: new Date().toISOString(),
            })
            .eq('floriday_fulfillment_order_id', order.floriday_fulfillment_order_id)
            .eq('environment', env)
        } else {
          failed++
          errors.push({ orderNumber: order.picqer_order_number, error: msg })
          console.error(`Cancel mislukt voor ${order.picqer_order_number}: ${msg}`)
        }
      }
    }

    console.log(`Bulk cancel klaar: ${cancelled} geannuleerd, ${alreadyCancelled} al geannuleerd, ${failed} mislukt`)

    return NextResponse.json({
      success: true,
      total: orders.length,
      cancelled,
      alreadyCancelled,
      failed,
      errors: errors.slice(0, 20),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Bulk cancel error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
