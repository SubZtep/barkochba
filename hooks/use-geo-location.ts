import { useEffect, useState } from "react"
import { type GeoLocation, lookupMyLocation } from "../lib/geo"
import { log } from "../lib/logger"

/**
 * Resolves the user's geographic location on mount via lib/geo's
 * module-cached lookup, so remounts and other callers don't repeat the
 * network round trip.
 */
export function useGeoLocation() {
  const [location, setLocation] = useState<GeoLocation | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    lookupMyLocation()
      .then(setLocation)
      .catch((err: Error) => {
        log.warn({ error: err }, "Geo lookup failed")
        setError(err)
      })
  }, [])

  return { location, error }
}
