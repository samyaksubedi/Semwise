import type { Metadata } from "next";
import { SubjectSyllabusPage } from "@/features/syllabus/syllabus-review";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.syllabus.title };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubjectSyllabusPage subjectId={id} />;
}
