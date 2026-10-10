import type { Metadata } from "next"

import { ProfileScreen } from "@/components/profile/profile-screen"
import pkg from "@/package.json"

export const metadata: Metadata = { title: "Profile" }

export default function ProfilePage() {
  return <ProfileScreen version={pkg.version} />
}
