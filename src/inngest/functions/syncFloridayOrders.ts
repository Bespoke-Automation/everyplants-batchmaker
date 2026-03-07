import { floridayInngest } from "../floriday-client"
import { syncOrders } from "@/lib/floriday/sync/order-sync"

export const syncFloridayOrders = floridayInngest.createFunction(
  { id: "sync-floriday-orders", retries: 2 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    return await step.run("sync-orders", () => syncOrders())
  }
)
