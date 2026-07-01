"use client";

import { useState } from "react";

// Thumb 9:16 na lista + preview grande flutuante no hover/foco (desktop).
export function PostThumb({ src }: { src: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="relative aspect-[9/16] h-16 overflow-hidden rounded-md border border-border bg-bg-raised">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-text-faint">▦</span>
        )}
      </div>

      {open && src && (
        <div className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 hidden -translate-y-1/2 md:block">
          <div className="aspect-[9/16] h-80 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl shadow-black/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-full w-full object-cover" />
          </div>
        </div>
      )}
    </div>
  );
}
