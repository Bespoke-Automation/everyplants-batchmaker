import { NextResponse } from 'next/server'
import { getPrinters, isPrintNodeConfigured } from '@/lib/printnode/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/printnode/printers
 * Fetch available printers from PrintNode
 */
export async function GET() {
  try {
    if (!isPrintNodeConfigured()) {
      return NextResponse.json(
        { error: 'PrintNode is niet geconfigureerd. Voeg PRINTNODE_API_KEY toe aan de environment variables.' },
        { status: 503 },
      )
    }

    const printers = await getPrinters()

    return NextResponse.json({
      printers: printers.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        state: p.state,
        computer: p.computer ? { id: p.computer.id, name: p.computer.name, state: p.computer.state } : null,
      })),
    })
  } catch (error) {
    console.error('[printnode] Error fetching printers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch printers from PrintNode', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
