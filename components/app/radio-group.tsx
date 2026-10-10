"use client"

import { useLayoutEffect, useRef, type ComponentProps, type KeyboardEvent } from "react"

const STEP: Partial<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

function radiosIn(group: HTMLElement | null): HTMLElement[] {
  if (!group) return []
  return Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (radio) => !radio.hasAttribute("disabled") && radio.getAttribute("aria-disabled") !== "true",
  )
}

/**
 * role="radiogroup" container that gives the role="radio" buttons inside it the keyboard model
 * screen readers announce: one Tab stop (the checked option, else the first), Arrow keys move and
 * select, Home / End jump to the ends. Pass `selectOnFocus={false}` where choosing an option also
 * commits and closes something (the profile option drawer); Arrow keys then only move focus.
 */
export function RadioGroup({
  selectOnFocus = true,
  onKeyDown,
  children,
  ...props
}: Omit<ComponentProps<"div">, "role" | "ref"> & { selectOnFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  // Roving tabindex, re-derived from aria-checked after every render of the group.
  useLayoutEffect(() => {
    const radios = radiosIn(ref.current)
    const current = radios.find((radio) => radio.getAttribute("aria-checked") === "true") ?? radios[0]
    for (const radio of radios) radio.tabIndex = radio === current ? 0 : -1
  })

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const radios = radiosIn(event.currentTarget)
    const index = radios.indexOf(event.target as HTMLElement)
    if (index === -1) return
    const step = STEP[event.key]
    let next: number
    if (event.key === "Home") next = 0
    else if (event.key === "End") next = radios.length - 1
    else if (step) next = (index + step + radios.length) % radios.length
    else return
    event.preventDefault()
    const target = radios[next]
    if (!target) return
    target.focus()
    if (selectOnFocus && target.getAttribute("aria-checked") !== "true") target.click()
  }

  return (
    <div {...props} ref={ref} role="radiogroup" onKeyDown={handleKeyDown}>
      {children}
    </div>
  )
}
