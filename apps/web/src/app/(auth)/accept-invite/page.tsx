import type { Metadata } from "next";
import { AcceptInviteForm } from "@/features/auth/invite-form";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.auth.inviteTitle };

export default function AcceptInvitePage() {
  return <AcceptInviteForm />;
}
