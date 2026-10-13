import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";

import { getAuthSecret, isHostedDeployment } from "@/config/env";
import { isCoordinatorRole } from "@/lib/authorization";
import { getClientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/db";
import { clearRateLimit, consumeRateLimit } from "@/services/rate-limit";

const credentialsSchema = z.object({
  email: z
    .email()
    .trim()
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8)
    .max(200)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
});

const dummyPasswordHash =
  "$2b$12$5GBKoOAkslDDftFVQUdUmOB1SlMd.6cgY8ddgRxfmtFcGRQ.Qiony";
const loginWindowMinutes = 15;

export const authOptions: NextAuthOptions = {
  secret: getAuthSecret(),
  useSecureCookies: isHostedDeployment(),
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  jwt: {
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const requestIp = getClientIp(request.headers);
        const pairIdentity = `${requestIp}:${parsed.data.email}`;
        const ipAllowed = await consumeRateLimit({
          action: "coordinator-login-ip",
          identity: requestIp,
          limit: 60,
          windowMinutes: loginWindowMinutes,
        });

        // The coarse IP bucket is intentionally consumed first. Once it is
        // blocked, rotating account names must not allocate finer throttle
        // keys indefinitely.
        if (!ipAllowed) {
          return null;
        }

        const [pairAllowed, accountAllowed] = await Promise.all([
          consumeRateLimit({
            action: "coordinator-login-pair",
            identity: pairIdentity,
            limit: 10,
            windowMinutes: loginWindowMinutes,
          }),
          consumeRateLimit({
            action: "coordinator-login-account",
            identity: parsed.data.email,
            limit: 20,
            windowMinutes: loginWindowMinutes,
          }),
        ]);

        if (!pairAllowed || !accountAllowed) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            role: true,
            isActive: true,
            mustChangePassword: true,
            sessionVersion: true,
            disabledAt: true,
            municipalityId: true,
            organizationId: true,
          },
        });

        const passwordMatches = await compare(
          parsed.data.password,
          user?.passwordHash ?? dummyPasswordHash,
        );

        if (
          !user?.passwordHash ||
          !user.isActive ||
          user.disabledAt !== null ||
          !isCoordinatorRole(user.role) ||
          !passwordMatches
        ) {
          return null;
        }

        const loggedInAt = new Date();
        const recordedLogin = await prisma.$transaction(async (transaction) => {
          const updated = await transaction.user.updateMany({
            where: {
              id: user.id,
              passwordHash: user.passwordHash,
              isActive: true,
              disabledAt: null,
              mustChangePassword: user.mustChangePassword,
              sessionVersion: user.sessionVersion,
            },
            data: { lastLoginAt: loggedInAt },
          });
          if (updated.count !== 1) return false;

          await transaction.auditLog.create({
            data: {
              actorId: user.id,
              municipalityId: user.municipalityId,
              action: "auth.login_succeeded",
              entityType: "User",
              entityId: user.id,
              metadata: {
                sessionVersion: user.sessionVersion,
                loggedInAt: loggedInAt.toISOString(),
              },
            },
          });
          return true;
        });

        if (!recordedLogin) {
          return null;
        }

        await Promise.all([
          clearRateLimit({
            action: "coordinator-login-pair",
            identity: pairIdentity,
            windowMinutes: loginWindowMinutes,
          }),
          clearRateLimit({
            action: "coordinator-login-account",
            identity: parsed.data.email,
            windowMinutes: loginWindowMinutes,
          }),
        ]);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          municipalityId: user.municipalityId,
          organizationId: user.organizationId,
          mustChangePassword: user.mustChangePassword,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.municipalityId = user.municipalityId;
        token.organizationId = user.organizationId;
        token.mustChangePassword = user.mustChangePassword;
        token.sessionVersion = user.sessionVersion;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.municipalityId = token.municipalityId;
        session.user.organizationId = token.organizationId;
        session.user.mustChangePassword = token.mustChangePassword;
        session.user.sessionVersion = token.sessionVersion;
      }

      return session;
    },
  },
};
