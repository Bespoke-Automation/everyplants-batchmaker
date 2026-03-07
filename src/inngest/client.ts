import { Inngest } from "inngest"

export const inngest = new Inngest({
  id: "everyplants-batchmaker",
  eventKey: process.env.INNGEST_EVENT_KEY,
})
