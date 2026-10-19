import type { Metadata } from "next";
import { TeacherClassesPage } from "@/features/teacher/classes";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.teacher.classesTitle };

export default function Page() {
  return <TeacherClassesPage />;
}
