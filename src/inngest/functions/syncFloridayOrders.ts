import { inngest } from "../client"
import { syncOrders } from "@/lib/floriday/sync/order-sync"

export const syncFloridayOrders = inngest.createFunction(
  { id: "sync-floriday-orders", retries: 2 },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    return await step.run("sync-orders", () => syncOrders())
  }
)
