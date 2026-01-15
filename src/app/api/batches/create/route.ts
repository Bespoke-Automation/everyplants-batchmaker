import { NextResponse } from 'next/server'
import { createPicklistBatch } from '@/lib/picqer/client'

interface CreateBatchRequest {
  picklistIds: number[]
  ppsFilter: 'ja' | 'nee'
}

interface CreateBatchResponse {
  success: boolean
  batchId?: number
  picklistCount: number
  webhookTriggered: boolean
  error?: string
}

export async function POST(request: Request) {
  try {
    const body: CreateBatchRequest = await request.json()
    const { picklistIds, ppsFilter } = body

    // Validate request
    if (!Array.isArray(picklistIds) || picklistIds.length === 0) {
      return NextResponse.json<CreateBatchResponse>(
        { success: false, picklistCount: 0, webhookTriggered: false, error: 'No picklist IDs provided' },
        { status: 400 }
      )
    }

    if (!picklistIds.every(id => typeof id === 'number')) {
      return NextResponse.json<CreateBatchResponse>(
        { success: false, picklistCount: 0, webhookTriggered: false, error: 'Invalid picklist IDs - must be numbers' },
        { status: 400 }
      )
    }

    console.log(`Creating batch with ${picklistIds.length} picklists, PPS filter: ${ppsFilter}`)

    // Step 1: Create batch in Picqer
    const batchResult = await createPicklistBatch(picklistIds)
    const batchId = batchResult.idpicklist_batch

    console.log(`Batch created in Picqer: ${batchId}`)

    // Step 2: Trigger Grive webhook
    let webhookTriggered = false
    const webhookUrl = 'https://everyplants.grive-dev.com/webhook/ba6eff16-76e9-48d6-bb97-20e4f02fc289'

    try {
      const webhookBody = {
        picklists: picklistIds,
        filter: ppsFilter === 'ja' ? 'true' : 'false',
        batchid: batchId,
      }

      console.log('Triggering Grive webhook:', webhookUrl)
      console.log('Webhook body:', JSON.stringify(webhookBody))

      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookBody),
      })

      if (webhookResponse.ok) {
        webhookTriggered = true
        console.log('Grive webhook triggered successfully')
      } else {
        console.error(`Grive webhook failed: ${webhookResponse.status}`)
      }
    } catch (webhookError) {
      // Log error but don't fail the request - batch is already created
      console.error('Error triggering Grive webhook:', webhookError)
    }

    return NextResponse.json<CreateBatchResponse>({
      success: true,
      batchId,
      picklistCount: picklistIds.length,
      webhookTriggered,
    })
  } catch (error) {
    console.error('Error creating batch:', error)
    return NextResponse.json<CreateBatchResponse>(
      {
        success: false,
        picklistCount: 0,
        webhookTriggered: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
