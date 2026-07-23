import { config } from "./config"

export interface GeoLocation {
  continent: { geonameId: number; name: string; code: string }
  country: {
    geonameId: number
    name: string
    isoCode: string
    isInEuropeanUnion: boolean
  }
  subdivisions: { geonameId: number; name: string; isoCode: string }[]
  city: { geonameId: number; name: string }
  postalCode?: string
  location: {
    accuracyRadius: number
    latitude: number
    longitude: number
    timeZone: string
  }
}

let myLocation: GeoLocation | null = null

/**
 * Resolves the user's public IP and looks up its geographic location via the
 * geo-service API (https://github.com/SubZtep/geo-service). The result is
 * cached module-wide, so after the startup call every later caller (e.g. LLM
 * tools) gets the cached value without a network round trip.
 */
export async function lookupMyLocation(): Promise<GeoLocation> {
  if (myLocation) return myLocation

  const { location } = await config()
  if (!location) throw new Error("Location feature not configured")

  const ipRes = await fetch("https://api.ipify.org")
  if (!ipRes.ok) throw new Error(`Public IP lookup failed: ${ipRes.status}`)
  const ip = (await ipRes.text()).trim()

  const res = await fetch(`${location.serviceUrl}/lookup/${ip}`, {
    headers: {
      "X-API-Key": location.apiKey
    }
  })
  if (!res.ok)
    throw new Error(`Geo lookup failed: ${res.status} ${await res.text()}`)
  myLocation = (await res.json()) as GeoLocation
  return myLocation
}

/**
 * Like {@link lookupMyLocation}, but resolves to `undefined` instead of
 * throwing when location isn't configured or the lookup fails — for callers
 * (tools) that want to use it as an optional default, not a hard requirement.
 */
export async function tryLookupMyLocation(): Promise<GeoLocation | undefined> {
  try {
    return await lookupMyLocation()
  } catch {
    return undefined
  }
}
