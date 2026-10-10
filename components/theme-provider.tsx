"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * next-themes provider (class strategy). Theme is changed from Profile > Appearance.
 * There is deliberately no single-key "d" shortcut: an unmodified letter shortcut fires during
 * select typeahead and speech input and cannot be turned off (WCAG 2.1.4).
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
