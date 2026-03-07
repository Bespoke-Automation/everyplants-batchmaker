import { serve } from "inngest/next"
import { floridayInngest } from "@/inngest/floriday-client"
import { processSingleOrderBatch } from "@/inngest/functions/processSingleOrderBatch"
import { syncFloridayOrders } from "@/inngest/functions/syncFloridayOrders"
import { syncCatalogSupply } from "@/inngest/functions/syncCatalogSupply"
import { processStockSyncQueue } from "@/inngest/functions/processStockSyncQueue"
import { reconcileFloridayStock } from "@/inngest/functions/reconcileFloridayStock"

export const { GET, POST, PUT } = serve({
  client: floridayInngest,
  functions: [
    processSingleOrderBatch,
    syncFloridayOrders,
    syncCatalogSupply,
    processStockSyncQueue,
    reconcileFloridayStock,
  ],
  signingKey: process.env.INNGEST_FLORIDAY_SIGNING_KEY,
})
