"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  glyph,
  children,
}: {
  href: string;
  glyph: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-surface text-text"
          : "text-text-dim hover:bg-surface/50 hover:text-text"
      }`}
    >
      <span className={active ? "text-amber" : "text-text-faint group-hover:text-amber"}>
        {glyph}
      </span>
      {children}
    </Link>
  );
}
