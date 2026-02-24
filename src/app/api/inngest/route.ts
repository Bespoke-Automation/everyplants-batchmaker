import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { processSingleOrderBatch } from "@/inngest/functions/processSingleOrderBatch"
import { syncFloridayOrders } from "@/inngest/functions/syncFloridayOrders"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processSingleOrderBatch, syncFloridayOrders],
})
