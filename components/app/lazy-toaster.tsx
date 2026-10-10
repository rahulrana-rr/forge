"use client"

import dynamic from "next/dynamic"
import type { ToasterProps } from "sonner"

/**
 * Sonner's Toaster in its own chunk, loaded after hydration, so pages that never toast (landing,
 * sign-in, 404) do not carry it in their first-load JS. Sonner replays toasts raised before the
 * Toaster subscribes, so nothing is lost while it loads.
 */
const Toaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), { ssr: false })

export function LazyToaster(props: ToasterProps) {
  return <Toaster {...props} />
}
