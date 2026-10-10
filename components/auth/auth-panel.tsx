"use client"

import { useState } from "react"

import { useSession } from "@/lib/auth-client"

import { CardSkeleton } from "@/components/app/skeletons"
import { EmailPasswordForm, type AuthMode } from "@/components/auth/email-password-form"
import { GoogleButton } from "@/components/auth/google-button"
import { MagicLinkForm } from "@/components/auth/magic-link-form"
import { SignedInCard } from "@/components/auth/signed-in-card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1"

export function AuthPanel() {
  const { data: session, isPending } = useSession()
  const [mode, setMode] = useState<AuthMode>("sign-in")

  if (isPending) return <CardSkeleton />
  if (session?.user) return <SignedInCard email={session.user.email} name={session.user.name} />

  return (
    <div className="flex flex-col gap-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v === "sign-up" ? "sign-up" : "sign-in")}>
        {/* The primitive sets its height with a group-data-horizontal variant, so the override must use it
            too. 52px minus the 4px padding leaves 44px tabs. */}
        <TabsList className="w-full rounded-2xl bg-surface-2 p-1 group-data-horizontal/tabs:h-13">
          <TabsTrigger value="sign-in" className="h-full rounded-xl text-base data-active:bg-background data-active:shadow-card">
            Sign in
          </TabsTrigger>
          <TabsTrigger value="sign-up" className="h-full rounded-xl text-base data-active:bg-background data-active:shadow-card">
            Create account
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sign-in" className="pt-4">
          <EmailPasswordForm mode="sign-in" />
        </TabsContent>
        <TabsContent value="sign-up" className="pt-4">
          <EmailPasswordForm mode="sign-up" />
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-label text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-3">
        <MagicLinkForm />
        {GOOGLE_ENABLED ? <GoogleButton /> : null}
      </div>
    </div>
  )
}
