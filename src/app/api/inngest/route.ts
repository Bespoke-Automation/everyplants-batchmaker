import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { processSingleOrderBatch } from "@/inngest/functions/processSingleOrderBatch"
import { syncFloridayOrders } from "@/inngest/functions/syncFloridayOrders"
import { syncCatalogSupply } from "@/inngest/functions/syncCatalogSupply"
import { processStockSyncQueue } from "@/inngest/functions/processStockSyncQueue"
import { reconcileFloridayStock } from "@/inngest/functions/reconcileFloridayStock"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processSingleOrderBatch,
    syncFloridayOrders,
    syncCatalogSupply,
    processStockSyncQueue,
    reconcileFloridayStock,
  ],
})
