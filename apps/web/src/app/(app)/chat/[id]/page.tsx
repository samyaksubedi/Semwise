import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatPage } from "@/features/chat/chat-page";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.chat.title };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ChatPage id={id} />
    </Suspense>
  );
}
