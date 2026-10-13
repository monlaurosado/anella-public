"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      title="Cerrar sesión"
      className="inline-flex size-11 items-center justify-center rounded-md border border-[color:var(--border)] transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
    >
      <LogOut size={17} aria-hidden />
      <span className="sr-only">Cerrar sesión</span>
    </button>
  );
}
