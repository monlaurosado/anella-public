import type { UserRole } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: UserRole;
      municipalityId?: string | null;
      organizationId?: string | null;
      mustChangePassword?: boolean;
      sessionVersion?: number;
    };
  }

  interface User {
    id: string;
    role?: UserRole;
    municipalityId?: string | null;
    organizationId?: string | null;
    mustChangePassword?: boolean;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    municipalityId?: string | null;
    organizationId?: string | null;
    mustChangePassword?: boolean;
    sessionVersion?: number;
  }
}
