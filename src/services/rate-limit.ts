import "server-only";

import { createHash } from "node:crypto";

import { getAuthSecret } from "@/config/env";
import { prisma } from "@/lib/db";

function getWindowStart(windowMinutes: number) {
  const windowMs = windowMinutes * 60 * 1000;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

function getKeyHash(identity: string) {
  return createHash("sha256")
    .update(`${getAuthSecret()}:${identity}`)
    .digest("hex");
}

export async function consumeRateLimit({
  action,
  identity,
  limit,
  windowMinutes,
}: {
  action: string;
  identity: string;
  limit: number;
  windowMinutes: number;
}) {
  const windowStart = getWindowStart(windowMinutes);
  const keyHash = getKeyHash(identity);

  const entry = await prisma.submissionThrottle.upsert({
    where: {
      keyHash_action_windowStart: { keyHash, action, windowStart },
    },
    update: { count: { increment: 1 } },
    create: { keyHash, action, windowStart, count: 1 },
  });

  return entry.count <= limit;
}

export async function clearRateLimit({
  action,
  identity,
  windowMinutes,
}: {
  action: string;
  identity: string;
  windowMinutes: number;
}) {
  await prisma.submissionThrottle.deleteMany({
    where: {
      action,
      keyHash: getKeyHash(identity),
      windowStart: getWindowStart(windowMinutes),
    },
  });
}
