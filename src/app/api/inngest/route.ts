import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { processSingleOrderBatch } from "@/inngest/functions/processSingleOrderBatch"
import { syncPicqerTags } from "@/inngest/functions/syncPicqerTags"
import { autoAssignBoxTags } from "@/inngest/functions/autoAssignBoxTags"
import { syncShopifyTracking } from "@/inngest/functions/syncShopifyTracking"
import { healStuckPackingSessions } from "@/inngest/functions/healStuckPackingSessions"

export const maxDuration = 300 // 5 minutes per step execution

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processSingleOrderBatch,
    syncPicqerTags,
    autoAssignBoxTags,
    syncShopifyTracking,
    healStuckPackingSessions,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
