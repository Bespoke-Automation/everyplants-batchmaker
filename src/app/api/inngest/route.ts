import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { processSingleOrderBatch } from "@/inngest/functions/processSingleOrderBatch"
import { syncPicqerTags } from "@/inngest/functions/syncPicqerTags"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processSingleOrderBatch,
    syncPicqerTags,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
