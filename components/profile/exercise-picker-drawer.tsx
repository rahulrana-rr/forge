"use client"

import { useId, useMemo, useRef, useState, type CSSProperties } from "react"
import { Plus, Search } from "lucide-react"

import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { CATEGORY_LABELS, EQUIPMENT_LABELS, EXERCISES } from "@/lib/exercises"
import { haptic } from "@/lib/haptics"

const MAX_RESULTS = 60

/** Searchable list of the exercise library; picking one calls onPick with its id. */
export function ExercisePickerDrawer({
  open,
  onOpenChange,
  excludedIds,
  onPick,
  title = "Add exercise to avoid",
  description = "It won't be programmed again. You can allow it later.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ids left out of the results (already in the list being edited). */
  excludedIds: string[]
  onPick: (id: string) => void
  title?: string
  description?: string
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const excluded = new Set(excludedIds)
    return EXERCISES.filter(
      (e) =>
        !excluded.has(e.id) &&
        (q === "" || e.name.toLowerCase().includes(q) || CATEGORY_LABELS[e.category].toLowerCase().includes(q)),
    )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS)
  }, [query, excludedIds])

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery("")
      }}
      showSwipeHandle
    >
      <DrawerContent
        className="rounded-t-3xl bg-card"
        style={{ "--drawer-height": "85dvh" } as CSSProperties}
        initialFocus={inputRef}
      >
        <DrawerHeader className="px-5 pt-1 pb-3 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <DrawerTitle className="font-heading text-xl font-bold tracking-tight">{title}</DrawerTitle>
          <DrawerDescription className="text-left">{description}</DrawerDescription>
        </DrawerHeader>
        <div className="px-5 pb-3">
          <div className="flex h-12 items-center gap-2 rounded-2xl bg-surface-2 px-4 transition-shadow focus-within:ring-3 focus-within:ring-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <label htmlFor={inputId} className="sr-only">
              Search exercises
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises"
              autoComplete="off"
              enterKeyHint="search"
              className="h-full w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
          {results.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {results.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("tap")
                      onPick(e.id)
                    }}
                    className="-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold">{e.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {CATEGORY_LABELS[e.category]} · {e.equipment.map((eq) => EQUIPMENT_LABELS[eq]).join(", ")}
                      </span>
                    </span>
                    <Plus className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No exercises match.</p>
          )}
          {results.length === MAX_RESULTS ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Showing the first {MAX_RESULTS}. Keep typing to narrow it down.
            </p>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
