import { Info } from "lucide-react"

import { ENGINE_VERSION } from "@/lib/engine/types"

import { SectionCard } from "./section-card"
import { SettingRow } from "./setting-row"

export function AboutSection({ version }: { version: string }) {
  return (
    <SectionCard id="about" title="About">
      <div className="flex flex-col divide-y divide-border">
        <SettingRow label="Version" value={`v${version}`} />
        <SettingRow label="Workout engine" value={`v${ENGINE_VERSION}`} />
        <p className="flex items-start gap-3 px-5 py-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>FORGE is not medical advice; consult a professional for injuries.</span>
        </p>
      </div>
    </SectionCard>
  )
}
