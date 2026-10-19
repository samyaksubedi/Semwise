import {
  BookOpen,
  Building2,
  CalendarDays,
  CheckCheck,
  FileText,
  GitFork,
  Home,
  LayoutGrid,
  ListChecks,
  MessageCircle,
  PenLine,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/lib/nav";

const ICONS: Record<IconName, LucideIcon> = {
  chat: MessageCircle,
  calendar: CalendarDays,
  pencil: PenLine,
  list: ListChecks,
  check: CheckCheck,
  book: BookOpen,
  home: Home,
  tree: GitFork,
  file: FileText,
  users: Users,
  grid: LayoutGrid,
  settings: Settings,
  building: Building2,
  user: User,
};

export function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden className={className} />;
}
