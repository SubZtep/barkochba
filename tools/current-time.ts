import { tool } from "../lib/agents"

/**
 * Gets the current date and time in a given timezone, formatted as an
 * ISO 8601 string with UTC offset (e.g. `2026-07-14T15:04:05-04:00`).
 *
 * @param args.timezone - IANA timezone name (e.g. `America/New_York`).
 * Defaults to the host system's local timezone; the model should pass the
 * user's own timezone (from the location grounding in the system prompt)
 * when it wants that instead.
 */
export const currentTimeTool = tool<{ timezone?: string }>({
  name: "current_time",
  description:
    "Get the current date and time in a given IANA timezone (e.g. 'America/New_York'). Defaults to the local timezone — pass the user's timezone explicitly if you know it.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA timezone name, e.g. 'America/New_York'"
      }
    },
    required: []
  },
  execute: async (args) => {
    const timeZone =
      args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const now = new Date()

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset"
    }).formatToParts(now)

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value

    const offset = (get("timeZoneName") ?? "GMT").replace("GMT", "") || "+00:00"

    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset} (${timeZone})`
  }
})
