import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavLink } from "./nav-link";

const NAV = [
  { href: "/dashboard", label: "Visão geral", glyph: "◴" },
  { href: "/dashboard/accounts", label: "Contas", glyph: "◍" },
  { href: "/dashboard/media", label: "Mídia", glyph: "▦" },
  { href: "/dashboard/presets", label: "Presets", glyph: "◆" },
  { href: "/dashboard/schedule", label: "Agenda", glyph: "◷" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-amber focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-bg"
      >
        Pular para o conteúdo
      </a>
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-bg-raised/60 px-5 py-7">
        <Link
          href="/dashboard"
          className="mb-10 block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-amber">
            ● darkroom
          </span>
          <span className="mt-1 block font-display text-2xl font-light tracking-tight">
            Stories
          </span>
        </Link>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} glyph={item.glyph}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3 border-t border-border pt-5">
          <p className="truncate font-mono text-xs text-text-faint" title={user.email}>
            {user.email}
          </p>
          <form action="/auth/signout" method="post">
            <button className="rounded-sm text-sm text-text-dim underline-offset-4 transition-colors hover:text-red hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
              Sair
            </button>
          </form>
        </div>
      </aside>

      <main id="main" className="flex-1 px-10 py-9">{children}</main>
    </div>
  );
}
