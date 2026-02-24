import { NextRequest, NextResponse } from 'next/server'
import { subscribeWebhook, deleteWebhook } from '@/lib/floriday/client'
import { getFloridayEnv } from '@/lib/floriday/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/webhooks/subscribe
 *
 * Registreert onze webhook URL bij Floriday.
 * Floriday stuurt daarna een confirmatie POST naar onze callback URL
 * met een subscribeURL die we moeten GET-ten (afgehandeld in webhooks/route.ts).
 *
 * Body: { callbackUrl: string } (optioneel — default: auto-detect)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const env = getFloridayEnv()

    // Gebruik meegegeven callbackUrl of bepaal automatisch
    let callbackUrl = body.callbackUrl
    if (!callbackUrl) {
      // Auto-detect van de request headers
      const host = request.headers.get('host')
      const proto = request.headers.get('x-forwarded-proto') || 'https'
      callbackUrl = `${proto}://${host}/api/floriday/webhooks`
    }

    console.log(`Registering Floriday webhook [${env}]: ${callbackUrl}`)
    await subscribeWebhook(callbackUrl)

    return NextResponse.json({
      success: true,
      environment: env,
      callbackUrl,
      message: 'Webhook geregistreerd. Wacht op confirmatie van Floriday.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Webhook registration failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/floriday/webhooks/subscribe
 *
 * Verwijdert onze webhook registratie bij Floriday.
 *
 * Body: { callbackUrl: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const env = getFloridayEnv()

    if (!body.callbackUrl) {
      return NextResponse.json({ error: 'callbackUrl is verplicht' }, { status: 400 })
    }

    console.log(`Deleting Floriday webhook [${env}]: ${body.callbackUrl}`)
    await deleteWebhook(body.callbackUrl)

    return NextResponse.json({
      success: true,
      environment: env,
      message: 'Webhook registratie verwijderd.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Webhook deletion failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
