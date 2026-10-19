import type { Role, SessionView } from "@semwise/shared";
import { t } from "./strings";

/** A part of the app for one kind of work. Menus reflect roles; the API enforces permissions. */
export type Area = "student" | "cr" | "teacher" | "admin" | "platform";

export type IconName =
  | "chat"
  | "calendar"
  | "pencil"
  | "list"
  | "check"
  | "book"
  | "home"
  | "tree"
  | "file"
  | "users"
  | "grid"
  | "settings"
  | "building"
  | "user";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** A count shown on the item (entries waiting for approval). */
  badge?: number;
}

const profile: NavItem = { href: "/profile", label: t.nav.profile, icon: "user" };

const AREAS: Record<Area, { label: string; home: string; items: NavItem[] }> = {
  student: {
    label: t.areas.student,
    home: "/chat",
    items: [
      { href: "/chat", label: t.nav.chat, icon: "chat" },
      { href: "/catchup", label: t.nav.catchup, icon: "calendar" },
    ],
  },
  cr: {
    label: t.areas.cr,
    home: "/today",
    items: [
      { href: "/today", label: t.nav.today, icon: "pencil" },
      { href: "/entries", label: t.nav.myEntries, icon: "list" },
      { href: "/chat", label: t.nav.chat, icon: "chat" },
      { href: "/catchup", label: t.nav.catchup, icon: "calendar" },
    ],
  },
  teacher: {
    label: t.areas.teacher,
    home: "/approvals",
    items: [
      { href: "/approvals", label: t.nav.approvals, icon: "check" },
      { href: "/classes", label: t.nav.myClasses, icon: "book" },
    ],
  },
  admin: {
    label: t.areas.admin,
    home: "/admin",
    items: [
      { href: "/admin", label: t.nav.overview, icon: "home" },
      { href: "/admin/structure", label: t.nav.structure, icon: "tree" },
      { href: "/admin/syllabus", label: t.nav.syllabus, icon: "file" },
      { href: "/admin/students", label: t.nav.students, icon: "users" },
      { href: "/admin/classes", label: t.nav.classes, icon: "grid" },
      { href: "/admin/settings", label: t.nav.settings, icon: "settings" },
    ],
  },
  platform: {
    label: t.areas.platform,
    home: "/platform/colleges",
    items: [{ href: "/platform/colleges", label: t.nav.colleges, icon: "building" }],
  },
};

const has = (session: SessionView, role: Role) => session.roles.some((r) => r.role === role);

/** The areas a person can open, most administrative first. */
export function areasFor(session: SessionView): Area[] {
  const areas: Area[] = [];
  if (session.user.isSuperAdmin) areas.push("platform");
  if (session.activeTenantId) {
    if (has(session, "UNIVERSITY_ADMIN") || has(session, "PROGRAM_ADMIN")) areas.push("admin");
    if (has(session, "TEACHER")) areas.push("teacher");
    if (has(session, "CR")) areas.push("cr");
    else if (has(session, "STUDENT")) areas.push("student");
  }
  return areas;
}

/** Which area a path belongs to (the profile page belongs to whichever area was open). */
export function areaOfPath(pathname: string): Area | null {
  if (pathname.startsWith("/platform")) return "platform";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/approvals") || pathname.startsWith("/classes")) return "teacher";
  if (pathname.startsWith("/today") || pathname.startsWith("/entries")) return "cr";
  if (pathname.startsWith("/chat") || pathname.startsWith("/catchup")) return "student";
  return null;
}

/**
 * The area to show: the one the path belongs to when the person has it. A CR also sees the
 * student pages inside the CR area, so they keep the CR tabs.
 */
export function currentArea(
  session: SessionView,
  pathname: string,
  last?: Area | null,
): Area | null {
  const areas = areasFor(session);
  let area = areaOfPath(pathname);
  if (area === "student" && areas.includes("cr") && !areas.includes("student")) area = "cr";
  if (area && areas.includes(area)) return area;
  if (last && areas.includes(last)) return last;
  return areas[0] ?? null;
}

export function homeFor(session: SessionView): string {
  const [area] = areasFor(session);
  return area ? AREAS[area].home : "/profile";
}

export function areaHome(area: Area): string {
  return AREAS[area].home;
}

export function areaLabel(area: Area): string {
  return AREAS[area].label;
}

/** The area's items plus Profile; the bottom bar shows at most five. */
export function navFor(area: Area): NavItem[] {
  return [...AREAS[area].items, profile];
}

/** Is `href` the active item for `pathname` (the longest matching prefix wins)? */
export function isActive(items: NavItem[], href: string, pathname: string): boolean {
  const matches = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const best = matches.sort((x, y) => y.href.length - x.href.length)[0];
  return best?.href === href;
}
