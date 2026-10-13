import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CoordinationNavigation } from "@/components/coordination/coordination-navigation";
import { requireCoordinator } from "@/lib/dal";

export const metadata: Metadata = {
  title: "Coordinación",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CoordinationLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const coordinator = await requireCoordinator({
    allowPasswordChangeRequired: true,
  });

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <CoordinationNavigation
        passwordChangeRequired={coordinator.mustChangePassword}
        role={coordinator.role}
      />
      <div data-coordination-content className="lg:pl-[min(16rem,30vw)]">
        <div
          id="contenido-coordinacion"
          className="min-h-screen pb-24 outline-none lg:pb-0"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
