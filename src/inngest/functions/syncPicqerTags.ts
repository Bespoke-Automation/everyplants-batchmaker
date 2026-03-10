import { inngest } from "../client"
import { getTags } from "@/lib/picqer/client"
import { upsertTagsFromPicqer } from "@/lib/supabase/localTags"

export const syncPicqerTags = inngest.createFunction(
  { id: "sync-picqer-tags", retries: 2 },
  { cron: "0 */12 * * *" },
  async ({ step }) => {
    return await step.run("sync-tags", async () => {
      const picqerTags = await getTags()
      const result = await upsertTagsFromPicqer(picqerTags)
      return { synced: picqerTags.length, ...result }
    })
  }
)
