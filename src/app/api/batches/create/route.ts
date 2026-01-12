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

    // Step 2: Trigger n8n webhook
    let webhookTriggered = false
    const webhookUrl = process.env.N8N_BATCH_WEBHOOK_URL

    if (webhookUrl) {
      try {
        const webhookBody = {
          picklists: picklistIds,
          filter: ppsFilter,
          batchid: batchId,
        }

        console.log('Triggering n8n webhook:', webhookUrl)
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
          console.log('n8n webhook triggered successfully')
        } else {
          console.error(`n8n webhook failed: ${webhookResponse.status}`)
        }
      } catch (webhookError) {
        // Log error but don't fail the request - batch is already created
        console.error('Error triggering n8n webhook:', webhookError)
      }
    } else {
      console.warn('N8N_BATCH_WEBHOOK_URL not configured')
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
