import { serve } from "inngest/next"
import { floridayInngest } from "@/inngest/floriday-client"
import { syncFloridayOrders } from "@/inngest/functions/syncFloridayOrders"
import { syncCatalogSupply } from "@/inngest/functions/syncCatalogSupply"
import { syncFloridayCatalog } from "@/inngest/functions/syncFloridayCatalog"
import { processStockSyncQueue } from "@/inngest/functions/processStockSyncQueue"
import { reconcileFloridayStock } from "@/inngest/functions/reconcileFloridayStock"

export const { GET, POST, PUT } = serve({
  client: floridayInngest,
  functions: [
    syncFloridayOrders,
    syncCatalogSupply,
    syncFloridayCatalog,
    processStockSyncQueue,
    reconcileFloridayStock,
  ],
  signingKey: process.env.INNGEST_FLORIDAY_SIGNING_KEY,
})
