import { Inngest } from "inngest"

/**
 * Aparte Inngest client voor Floriday functies.
 * Gebruikt eigen event key en signing key (INNGEST_FLORIDAY_*).
 */
export const floridayInngest = new Inngest({
  id: "everyplants-floriday",
  eventKey: process.env.INNGEST_FLORIDAY_EVENT_KEY,
})
