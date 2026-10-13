import { NextResponse } from "next/server";

import { getCachedPublicSnapshot } from "@/lib/public-incidents-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const { incidents } = await getCachedPublicSnapshot();

  return NextResponse.json(
    { incidents },
    {
      headers: {
        // A CDN must never keep serving a destination after it becomes unsafe.
        // Server mutations expire the short tagged cache synchronously, while
        // deadline eligibility is rechecked after every cached read.
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
