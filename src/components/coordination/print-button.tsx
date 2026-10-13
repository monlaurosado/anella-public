"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title="Imprimir QR"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-[color:var(--border)] print:hidden"
    >
      <Printer size={16} aria-hidden />
      <span className="sr-only">Imprimir QR</span>
    </button>
  );
}
