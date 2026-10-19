"use client";

import type { ApprovalItem } from "@semwise/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight, Lock, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, Skeleton } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import {
  areaLabel,
  areaOfPath,
  areasFor,
  currentArea,
  homeFor,
  isActive,
  navFor,
  type Area,
  type NavItem,
} from "@/lib/nav";
import { activeCollege, useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { t } from "@/lib/strings";

const LAST_AREA = "semwise-area";
const COLLAPSED = "semwise-sidebar";
const MAX_TABS = 5;

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Signed-in pages: the session guard, the navigation for the current area, and the content. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: session, isPending, isError } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  // Read once on the client. Hydration always renders the skeleton (the session is not loaded
  // yet), so these never change server-rendered markup.
  const [lastArea] = useState(() => readStored(LAST_AREA) as Area | null);
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED) === "1");

  useEffect(() => {
    if (isPending || isError) return;
    if (!session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!session.activeTenantId && !session.user.isSuperAdmin)
      router.replace("/choose-college");
  }, [session, isPending, isError, pathname, router]);

  const area = session ? currentArea(session, pathname, lastArea) : null;
  useEffect(() => {
    if (!area) return;
    try {
      sessionStorage.setItem(LAST_AREA, area);
    } catch {
      // Storage blocked: the area is worked out from the page each time.
    }
  }, [area]);
  // The count of entries waiting shows on the Approvals tab.
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<ApprovalItem[]>("/approvals"),
    enabled: area === "teacher",
    refetchInterval: 60_000,
  });

  if (isPending || !session || (!session.activeTenantId && !session.user.isSuperAdmin)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pt-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const waiting = approvals.data?.length ?? 0;
  const items = (area ? navFor(area) : []).map((item) =>
    item.href === "/approvals" && waiting ? { ...item, badge: waiting } : item,
  );
  const college = activeCollege(session);
  const pathArea = areaOfPath(pathname);
  const allowed = areasFor(session);
  const forbidden =
    pathArea !== null &&
    !allowed.includes(pathArea) &&
    !(pathArea === "student" && allowed.includes("cr"));

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED, value ? "0" : "1");
      } catch {
        // Not remembered; fine.
      }
      return !value;
    });
  };

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface font-medium shadow-lift focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-4 focus:py-3"
      >
        {t.nav.skip}
      </a>
      <Sidebar
        items={items}
        pathname={pathname}
        collegeName={college?.name ?? t.app.name}
        areaName={area ? areaLabel(area) : ""}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          collegeName={college?.name ?? t.app.name}
          initials={initials(session.user.displayName)}
        />
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            "focus:outline-none",
            "pb-tabbar mx-auto w-full flex-1 px-4 pt-4 md:px-8 md:pt-8 md:pb-10",
            // The syllabus review shows three panels side by side on wide screens.
            pathname.startsWith("/admin/syllabus/") ? "max-w-[1400px]" : "max-w-5xl",
          )}
        >
          {forbidden ? (
            <EmptyState
              icon={Lock}
              title={t.common.notFoundTitle}
              body={t.common.forbiddenBody}
              action={<ButtonLink href={homeFor(session)}>{t.common.goHome}</ButtonLink>}
            />
          ) : (
            children
          )}
        </main>
      </div>
      <BottomTabs items={items} pathname={pathname} />
    </div>
  );
}

/** "Approvals, 1 waiting": the label first, then the count (the badge itself is not read). */
function navName(item: NavItem): string | undefined {
  return item.badge ? `${item.label}, ${item.badge} ${t.nav.waitingCount}` : undefined;
}

/** A count on a nav item; links with a badge carry their full name in aria-label. */
function Badge({ count, floating }: { count: number; floating?: boolean }) {
  return (
    <span
      className={cn(
        "min-w-5 rounded-full bg-accent px-1.5 text-center text-xs leading-5 font-semibold text-on-accent",
        floating ? "absolute -top-1.5 -right-2.5" : "ml-auto",
      )}
    >
      {count}
    </span>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

function TopBar({ collegeName, initials }: { collegeName: string; initials: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <Logo />
        <span className="truncate font-semibold">{collegeName}</span>
      </div>
      <Link
        href="/profile"
        aria-label={t.nav.profile}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text"
      >
        {initials}
      </Link>
    </header>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-accent text-sm font-bold text-on-accent",
        className,
      )}
    >
      S
    </span>
  );
}

function Sidebar({
  items,
  pathname,
  collegeName,
  areaName,
  collapsed,
  onToggle,
}: {
  items: NavItem[];
  pathname: string;
  collegeName: string;
  areaName: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface md:flex",
        collapsed ? "w-[76px]" : "w-64",
      )}
    >
      <div className={cn("flex items-center gap-3 px-4 py-5", collapsed && "justify-center px-0")}>
        <Logo />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-semibold">{collegeName}</p>
            <p className="truncate text-xs text-muted">{areaName}</p>
          </div>
        )}
      </div>
      <nav aria-label={t.nav.mainNav} className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = isActive(items, item.href, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={navName(item)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-control px-3 text-[15px] font-medium transition-calm",
                    active
                      ? "bg-accent-soft text-accent-text"
                      : "text-muted hover:bg-surface-2 hover:text-text",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <NavIcon name={item.icon} className="size-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {item.badge ? <Badge count={item.badge} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
        className="m-3 flex h-10 items-center justify-center gap-2 rounded-control text-sm text-muted transition-calm hover:bg-surface-2 hover:text-text"
      >
        {collapsed ? (
          <ChevronsRight aria-hidden className="size-4" />
        ) : (
          <ChevronsLeft aria-hidden className="size-4" />
        )}
        {!collapsed && "Collapse"}
      </button>
    </aside>
  );
}

function BottomTabs({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const overflow = items.length > MAX_TABS;
  const shown = overflow ? items.slice(0, MAX_TABS - 1) : items;
  const hidden = overflow ? items.slice(MAX_TABS - 1) : [];
  const moreActive = hidden.some((item) => isActive(items, item.href, pathname));

  const tab = (active: boolean) =>
    cn(
      "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-calm",
      active ? "text-accent" : "text-muted",
    );

  return (
    <nav
      aria-label={t.nav.mainNav}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {shown.map((item) => {
          const active = isActive(items, item.href, pathname);
          return (
            <li key={item.href} className="flex min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={navName(item)}
                className={tab(active)}
              >
                <span className="relative">
                  <NavIcon name={item.icon} className="size-6" />
                  {item.badge ? <Badge count={item.badge} floating /> : null}
                </span>
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
        {overflow && (
          <li className="flex min-w-0 flex-1">
            <button type="button" onClick={() => setMoreOpen(true)} className={tab(moreActive)}>
              <MoreHorizontal aria-hidden className="size-6" />
              <span>{t.nav.more}</span>
            </button>
          </li>
        )}
      </ul>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t.nav.more}>
        <ul className="flex flex-col gap-1">
          {hidden.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex h-12 items-center gap-3 rounded-control px-3 text-[15px] font-medium hover:bg-surface-2"
              >
                <NavIcon name={item.icon} className="size-5 text-muted" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </nav>
  );
}
