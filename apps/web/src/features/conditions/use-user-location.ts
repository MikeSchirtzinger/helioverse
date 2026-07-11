/**
 * use-user-location.ts — Device geolocation for local aurora conditions.
 *
 * The local OVATION sample and sky gates require a specific latitude and
 * longitude. This hook supplies the user's real device location and never
 * substitutes a default city.
 *
 * PROVENANCE (per CLAUDE.md): device coordinates are MEASURED — the browser's
 * Geolocation API returns real GPS/network-derived latitude and longitude. The
 * place-name label is reverse-geocoded from those coordinates (BigDataCloud's
 * free client endpoint, no key, CORS-enabled); if that fails we fall back to a
 * raw "lat°, lon°" string. Nothing here is synthetic.
 *
 * Permission UX:
 *   - On mount we check the Permissions API. If geolocation was already
 *     granted, we fetch the position silently (no prompt).
 *   - If the state is "prompt" or the Permissions API is unavailable, we stay
 *     idle and wait for an explicit `request()` call — auto-prompting on page
 *     load is intrusive and bad UX.
 *   - "denied" is a terminal state until the user changes site permissions.
 *
 * The hook never throws; callers read `status` and render accordingly.
 */

import { useCallback, useEffect, useState } from "react";

export interface UserLocation {
  latDeg: number;
  lonDeg: number;
  label?: string;
}

export type UserLocationStatus =
  | "checking" // resolving initial permission state
  | "idle" // not yet requested (or permission is "prompt")
  | "requesting" // getCurrentPosition in flight
  | "granted" // have real coordinates
  | "denied" // user/site blocked geolocation
  | "unavailable" // no geolocation API at all
  | "error"; // API present but failed (timeout, etc.)

export interface UseUserLocationResult {
  /** Real device location, or null until granted. */
  location: UserLocation | null;
  status: UserLocationStatus;
  /** Human-readable reason when status is 'denied' | 'unavailable' | 'error'. */
  error: string | null;
  /** Trigger the permission prompt + position fetch (no-op if already granted
   *  or in a terminal failure state). Safe to call repeatedly. */
  request: () => void;
}

/** Compose a concise "City, CC" label from a BigDataCloud reverse-geocode body. */
function labelFromGeo(body: unknown): string {
  const b = body as {
    city?: string | null;
    locality?: string | null;
    principalSubdivision?: string | null;
    countryName?: string | null;
    countryCode?: string | null;
  } | null;
  const place = b?.city || b?.locality || b?.principalSubdivision || null;
  const cc = b?.countryCode || null;
  if (place && cc) return `${place}, ${cc}`;
  if (place) return place;
  return ""; // caller falls back to raw coordinates
}

/** Reverse-geocode lat/lon → place name. Non-fatal: returns "" on any failure. */
async function reverseGeocode(latDeg: number, lonDeg: number): Promise<string> {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${latDeg}&longitude=${lonDeg}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return "";
    return labelFromGeo(await res.json());
  } catch {
    return "";
  }
}

/** Format raw coordinates as a label fallback: "64.15°, -21.88°". */
function coordLabel(latDeg: number, lonDeg: number): string {
  return `${latDeg.toFixed(2)}°, ${lonDeg.toFixed(2)}°`;
}

export function useUserLocation(): UseUserLocationResult {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [status, setStatus] = useState<UserLocationStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  /** Fetch the current position and resolve to a UserLocation. */
  const fetchPosition = useCallback((): Promise<UserLocation> => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("unavailable"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const latDeg = pos.coords.latitude;
          const lonDeg = pos.coords.longitude;
          // Reverse-geocode for a friendly label; fall back to raw coords.
          const place = await reverseGeocode(latDeg, lonDeg);
          resolve({
            latDeg,
            lonDeg,
            label: place || coordLabel(latDeg, lonDeg),
          });
        },
        (err) => {
          // GeolocationPositionError is NOT an Error subclass, so
          // `err instanceof Error` is false and String(err) yields
          // "[object GeolocationPositionError]". Normalize to a real Error
          // with a human message based on the W3C error codes.
          const code = err?.code;
          let reason: string;
          if (code === 1) reason = "Permission denied";
          else if (code === 2) reason = "Position unavailable";
          else if (code === 3) reason = "Timed out";
          else reason = err?.message || "Geolocation error";
          reject(new Error(reason));
        },
        // enableHighAccuracy tries GPS first; a 10s timeout + maxAge 5min keeps
        // it responsive without re-pinging GPS on every request().
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
      );
    });
  }, []);

  /** Shared success/failure handlers for both the silent and explicit paths. */
  const settle = useCallback(
    async (p: Promise<UserLocation>) => {
      try {
        const loc = await p;
        setLocation(loc);
        setStatus("granted");
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "unavailable") {
          setStatus("unavailable");
          setError("This device doesn't expose geolocation.");
        } else if (/denied/i.test(msg) || /Permission/i.test(msg)) {
          setStatus("denied");
          setError("Location permission was denied.");
        } else {
          setStatus("error");
          setError(msg || "Couldn't get your location.");
        }
      }
    },
    [],
  );

  // On mount: resolve the initial permission state via the Permissions API.
  // If already granted, fetch silently. Otherwise drop to idle (wait for a
  // click) — we never auto-prompt.
  useEffect(() => {
    let cancelled = false;
    const permApi =
      typeof navigator !== "undefined" && navigator.permissions
        ? navigator.permissions
        : null;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setError("This device doesn't expose geolocation.");
      return;
    }

    if (!permApi) {
      // No Permissions API — can't tell the state without prompting, so stay
      // idle and let the user explicitly request.
      setStatus("idle");
      return;
    }

    permApi
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        const state = result.state; // 'granted' | 'prompt' | 'denied'
        if (state === "granted") {
          setStatus("requesting");
          void settle(fetchPosition());
        } else if (state === "denied") {
          setStatus("denied");
          setError("Location permission was denied.");
        } else {
          setStatus("idle");
        }
        // React to the user changing the permission in site settings later.
        result.onchange = () => {
          if (cancelled) return;
          if (result.state === "granted") {
            setStatus("requesting");
            void settle(fetchPosition());
          } else if (result.state === "denied") {
            setStatus("denied");
            setError("Location permission was denied.");
          }
        };
      })
      .catch(() => {
        if (!cancelled) setStatus("idle");
      });

    return () => {
      cancelled = true;
    };
  }, [fetchPosition, settle]);

  /** Explicit user action: prompt (if needed) and fetch. */
  const request = useCallback(() => {
    setStatus((prev) => {
      // No-op in terminal failure states; re-request is fine otherwise.
      if (prev === "unavailable") return prev;
      if (prev === "requesting") return prev;
      return "requesting";
    });
    void settle(fetchPosition());
  }, [fetchPosition, settle]);

  return { location, status, error, request };
}
