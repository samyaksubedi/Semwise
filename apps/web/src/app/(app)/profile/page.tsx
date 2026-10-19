import type { Metadata } from "next";
import { ProfilePage } from "@/features/profile/profile-page";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.profile.title };

export default function Page() {
  return <ProfilePage />;
}
