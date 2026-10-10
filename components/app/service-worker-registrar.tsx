"use client"

import { useEffect } from "react"

const WARM_KEY = "forge:sw-warm"
/** How often the worker re-fetches the shell pages so offline copies follow new deploys. */
const WARM_EVERY_MS = 12 * 60 * 60 * 1000

function readWarmedAt(): number {
  try {
    return Number(window.localStorage.getItem(WARM_KEY)) || 0
  } catch {
    return 0
  }
}

function markWarmed(): void {
  try {
    window.localStorage.setItem(WARM_KEY, String(Date.now()))
  } catch {
    // Storage unavailable: the worker is simply warmed again next time.
  }
}

/**
 * Registers public/sw.js, which keeps the app shell cached so a reload or a cold launch of the
 * installed app works with no signal. Production only: in development it removes any worker left
 * by a production build on the same origin, which would otherwise serve stale pages. Renders nothing.
 */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const sw = navigator.serviceWorker

    if (process.env.NODE_ENV !== "production") {
      sw.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .then(() => caches.keys())
        .then((names) => Promise.all(names.filter((n) => n.startsWith("forge-")).map((n) => caches.delete(n))))
        .catch(() => {})
      return
    }

    let cancelled = false
    const firstInstall = !sw.controller

    function register() {
      sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then(() => sw.ready)
        .then((registration) => {
          if (cancelled) return
          // A fresh install precaches the shell itself; afterwards refresh it twice a day while online.
          if (firstInstall) {
            markWarmed()
            return
          }
          if (!navigator.onLine || Date.now() - readWarmedAt() < WARM_EVERY_MS) return
          markWarmed()
          registration.active?.postMessage({ type: "warm" })
        })
        .catch(() => {
          // Unsupported or blocked (some private modes): the app still works while online.
        })
    }

    // Register after load so the worker's precache never competes with the page's own requests.
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener("load", register)
    }
  }, [])

  return null
}
