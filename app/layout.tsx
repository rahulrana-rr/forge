import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { LazyToaster } from "@/components/app/lazy-toaster"
import { ServiceWorkerRegistrar } from "@/components/app/service-worker-registrar"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "FORGE", template: "%s · FORGE" },
  description:
    "Your daily workout, programmed for you. Open the app, see the exercise, swipe to finish.",
  applicationName: "FORGE",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FORGE",
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#040507" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        geist.variable,
        geistMono.variable
      )}
    >
      <body className="min-h-screen-safe">
        <ThemeProvider defaultTheme="dark">
          {children}
          <LazyToaster position="top-center" />
        </ThemeProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
