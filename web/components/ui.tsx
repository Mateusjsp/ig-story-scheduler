import { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="animate-rise mb-9 flex items-end justify-between gap-6">
      <div>
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-amber">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-4xl font-light tracking-tight">
          {title}
        </h1>
      </div>
      {children}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface/50 p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card>
      <p className="font-mono text-xs uppercase tracking-wider text-text-faint">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-light tabular-nums">{value}</p>
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-16 text-center">
      <span aria-hidden="true" className="text-3xl text-text-faint">▦</span>
      <p className="font-display text-xl">{title}</p>
      <p className="max-w-sm text-sm text-text-dim">{hint}</p>
      {action}
    </Card>
  );
}

const BADGE: Record<string, string> = {
  queued: "border-amber/40 text-amber",
  publishing: "border-amber-bright/40 text-amber-bright",
  published: "border-green/40 text-green",
  failed: "border-red/40 text-red",
  active: "border-green/40 text-green",
  token_expired: "border-red/40 text-red",
};

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider ${
        BADGE[status] ?? "border-border text-text-dim"
      }`}
    >
      {status}
    </span>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-2 rounded-md bg-amber px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-amber-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
    >
      {children}
    </button>
  );
}
