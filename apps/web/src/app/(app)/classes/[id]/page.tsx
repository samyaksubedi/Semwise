import type { Metadata } from "next";
import { TeacherClassPage } from "@/features/teacher/classes";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.teacher.classesTitle };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeacherClassPage id={id} />;
}
