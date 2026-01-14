import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { processSingleOrderBatch } from "@/inngest/functions/processSingleOrderBatch"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processSingleOrderBatch],
})
