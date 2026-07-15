import { tool } from "../lib/agents"
import { lookupMyLocation } from "../lib/geo"

/**
 * Returns the user's current geographic location (city, country,
 * coordinates, timezone), resolved from their public IP. The lookup is
 * cached in `lib/geo`, so this is a network call at most once per run.
 */
export const myLocationTool = tool<Record<string, never>>({
  name: "my_location",
  description:
    "Get the user's current geographic location: city, country, latitude, longitude and IANA timezone.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
  execute: async () => {
    const loc = await lookupMyLocation()
    return JSON.stringify({
      city: loc.city.name,
      country: loc.country.name,
      latitude: loc.location.latitude,
      longitude: loc.location.longitude,
      timeZone: loc.location.timeZone
    })
  }
})
