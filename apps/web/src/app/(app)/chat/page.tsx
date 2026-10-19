import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatPage } from "@/features/chat/chat-page";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.chat.title };

export default function Page() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
