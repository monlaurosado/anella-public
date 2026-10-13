"use server";

import { compare, hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { assertCoordinator, type CoordinatorContext } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { signedFlashPath } from "@/lib/signed-flash";
import { clearRateLimit, consumeRateLimit } from "@/services/rate-limit";

const passwordSchema = z
  .string()
  .min(12, "La contraseña debe tener al menos 12 caracteres")
  .max(200)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "La contraseña no puede superar 72 bytes en UTF-8",
  );

const currentPasswordSchema = z
  .string()
  .min(1, "Confirma tu contraseña actual")
  .max(200)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "La contraseña actual no es válida",
  );

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(191),
  email: z
    .email()
    .trim()
    .transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(50).optional(),
  password: passwordSchema,
  currentPassword: currentPasswordSchema,
  role: z.enum(["COORDINATOR", "MUNICIPAL_ADMIN"]),
  municipalityId: z.string().trim().min(1).max(191).optional(),
  organizationId: z.string().trim().min(1).max(191).optional(),
});

const sensitiveActionReasonSchema = z
  .string()
  .trim()
  .min(8, "El motivo debe tener al menos 8 caracteres")
  .max(500, "El motivo no puede superar 500 caracteres");

const accountStatusSchema = z.object({
  userId: z.string().min(1),
  statusAction: z.enum(["activate", "deactivate"]),
  reason: sensitiveActionReasonSchema,
  currentPassword: currentPasswordSchema,
  confirmSensitiveAction: z.literal("confirmed"),
});

const passwordResetSchema = z.object({
  userId: z.string().min(1),
  password: passwordSchema,
  reason: sensitiveActionReasonSchema,
  currentPassword: currentPasswordSchema,
  confirmSensitiveAction: z.literal("confirmed"),
});

const serializableTransaction = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

type ManagingAdmin = {
  id: string;
  role: Extract<UserRole, "MUNICIPAL_ADMIN" | "SUPER_ADMIN">;
  municipalityId: string | null;
  organizationId: string | null;
};

const dummyPasswordHash =
  "$2b$12$5GBKoOAkslDDftFVQUdUmOB1SlMd.6cgY8ddgRxfmtFcGRQ.Qiony";
const sensitiveStepUpWindowMinutes = 15;

type SensitiveStepUpResult = "verified" | "invalid" | "rate-limited";

function safeTeamReturnPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.length > 2_000) {
    return "/coordinacion/equipo";
  }

  try {
    const url = new URL(value, "http://anella.internal");
    if (
      url.origin !== "http://anella.internal" ||
      url.pathname !== "/coordinacion/equipo"
    ) {
      return "/coordinacion/equipo";
    }
    for (const key of ["notice", "error", "flashAt", "flashSig"]) {
      url.searchParams.delete(key);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "/coordinacion/equipo";
  }
}

function teamPath(
  kind: "notice" | "error",
  message: string,
  returnPath = "/coordinacion/equipo",
) {
  return signedFlashPath(returnPath, kind, message);
}

function accountPath(kind: "notice" | "error", message: string) {
  return signedFlashPath("/coordinacion/cuenta", kind, message);
}

function loginPath(kind: "notice" | "error", message: string) {
  return signedFlashPath("/login", kind, message);
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function requireMunicipalAdmin() {
  const coordinator = await assertCoordinator();

  if (!["MUNICIPAL_ADMIN", "SUPER_ADMIN"].includes(coordinator.role)) {
    throw new Error("FORBIDDEN");
  }

  return coordinator;
}

async function getManagingAdmin(
  transaction: Prisma.TransactionClient,
  coordinator: CoordinatorContext,
): Promise<ManagingAdmin | null> {
  const actor = await transaction.user.findFirst({
    where: {
      id: coordinator.id,
      isActive: true,
      disabledAt: null,
      mustChangePassword: false,
      sessionVersion: coordinator.sessionVersion,
      role: { in: [UserRole.MUNICIPAL_ADMIN, UserRole.SUPER_ADMIN] },
    },
    select: {
      id: true,
      role: true,
      municipalityId: true,
      organizationId: true,
    },
  });

  if (!actor) {
    return null;
  }

  if (
    actor.role === UserRole.MUNICIPAL_ADMIN ||
    actor.role === UserRole.SUPER_ADMIN
  ) {
    return {
      id: actor.id,
      role: actor.role,
      municipalityId: actor.municipalityId,
      organizationId: actor.organizationId,
    };
  }

  return null;
}

function manageableUserWhere(admin: ManagingAdmin, userId: string) {
  return {
    id: userId,
    ...(admin.role === UserRole.SUPER_ADMIN
      ? {}
      : { municipalityId: admin.municipalityId ?? "__none__" }),
    role: { in: [UserRole.COORDINATOR, UserRole.MUNICIPAL_ADMIN] },
    NOT: { id: admin.id },
  } satisfies Prisma.UserWhereInput;
}

async function verifySensitiveAdminStepUp({
  coordinator,
  currentPassword,
  operation,
  target,
}: {
  coordinator: CoordinatorContext;
  currentPassword: string;
  operation: string;
  target: string;
}): Promise<SensitiveStepUpResult> {
  const actorAllowed = await consumeRateLimit({
    action: "admin-sensitive-step-up-actor",
    identity: coordinator.id,
    limit: 12,
    windowMinutes: sensitiveStepUpWindowMinutes,
  });
  if (!actorAllowed) return "rate-limited";

  const targetAllowed = await consumeRateLimit({
    action: "admin-sensitive-step-up-target",
    identity: `${coordinator.id}:${target}`,
    limit: 5,
    windowMinutes: sensitiveStepUpWindowMinutes,
  });
  if (!targetAllowed) return "rate-limited";

  const actor = await prisma.user.findFirst({
    where: {
      id: coordinator.id,
      isActive: true,
      disabledAt: null,
      mustChangePassword: false,
      sessionVersion: coordinator.sessionVersion,
      role: { in: [UserRole.MUNICIPAL_ADMIN, UserRole.SUPER_ADMIN] },
    },
    select: {
      id: true,
      passwordHash: true,
      municipalityId: true,
      sessionVersion: true,
    },
  });
  const passwordMatches = await compare(
    currentPassword,
    actor?.passwordHash ?? dummyPasswordHash,
  );

  if (!actor?.passwordHash || !passwordMatches) {
    if (actor) {
      await prisma.auditLog.create({
        data: {
          actorId: actor.id,
          municipalityId: actor.municipalityId,
          action: "auth.sensitive_step_up_failed",
          entityType: "User",
          entityId: actor.id,
          metadata: { operation, sessionVersion: actor.sessionVersion },
        },
      });
    }
    return "invalid";
  }

  await Promise.all([
    clearRateLimit({
      action: "admin-sensitive-step-up-actor",
      identity: coordinator.id,
      windowMinutes: sensitiveStepUpWindowMinutes,
    }),
    clearRateLimit({
      action: "admin-sensitive-step-up-target",
      identity: `${coordinator.id}:${target}`,
      windowMinutes: sensitiveStepUpWindowMinutes,
    }),
    prisma.auditLog.create({
      data: {
        actorId: actor.id,
        municipalityId: actor.municipalityId,
        action: "auth.sensitive_step_up_succeeded",
        entityType: "User",
        entityId: actor.id,
        metadata: { operation, sessionVersion: actor.sessionVersion },
      },
    }),
  ]);

  return "verified";
}

function rejectSensitiveStepUp(
  result: Exclude<SensitiveStepUpResult, "verified">,
  returnPath: string,
) {
  redirect(
    teamPath(
      "error",
      result === "rate-limited"
        ? "Demasiados intentos de confirmación. Espera unos minutos."
        : "No se pudo confirmar tu identidad. Revisa tu contraseña actual.",
      returnPath,
    ),
  );
}

export async function createCoordinator(formData: FormData) {
  const coordinator = await requireMunicipalAdmin();
  const returnPath = safeTeamReturnPath(formData.get("returnTo"));
  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    password: formData.get("password"),
    currentPassword: formData.get("currentPassword"),
    role: formData.get("role"),
    municipalityId: formData.get("municipalityId") || undefined,
    organizationId: formData.get("organizationId") || undefined,
  });

  if (!parsed.success) {
    redirect(
      teamPath(
        "error",
        parsed.error.issues[0]?.message ?? "Revisa los datos.",
        returnPath,
      ),
    );
  }

  const stepUp = await verifySensitiveAdminStepUp({
    coordinator,
    currentPassword: parsed.data.currentPassword,
    operation: "user.create",
    target: parsed.data.email,
  });
  if (stepUp !== "verified") rejectSensitiveStepUp(stepUp, returnPath);

  const passwordHash = await hash(parsed.data.password, 12);
  const changedAt = new Date();
  let result:
    | "created"
    | "no-municipality"
    | "invalid-municipality"
    | "invalid-organization"
    | "tenant-override"
    | "unauthorized" = "created";
  let duplicateEmail = false;

  try {
    result = await prisma.$transaction(async (transaction) => {
      const admin = await getManagingAdmin(transaction, coordinator);

      if (!admin) {
        return "unauthorized" as const;
      }

      let municipalityId: string;
      let organizationId: string | null;

      if (admin.role === UserRole.SUPER_ADMIN) {
        if (!parsed.data.municipalityId) {
          return "no-municipality" as const;
        }
        const municipality = await transaction.municipality.findUnique({
          where: { id: parsed.data.municipalityId },
          select: { id: true },
        });
        if (!municipality) {
          return "invalid-municipality" as const;
        }
        municipalityId = municipality.id;
        organizationId = parsed.data.organizationId ?? null;
      } else {
        if (!admin.municipalityId) {
          return "no-municipality" as const;
        }
        if (
          (parsed.data.municipalityId &&
            parsed.data.municipalityId !== admin.municipalityId) ||
          (parsed.data.organizationId &&
            parsed.data.organizationId !== admin.organizationId)
        ) {
          return "tenant-override" as const;
        }
        municipalityId = admin.municipalityId;
        organizationId = admin.organizationId;
      }

      if (organizationId) {
        const organization = await transaction.organization.findFirst({
          where: { id: organizationId, municipalityId },
          select: { id: true },
        });
        if (!organization) {
          return "invalid-organization" as const;
        }
      }

      const user = await transaction.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          phone: parsed.data.phone || null,
          passwordHash,
          role: parsed.data.role as UserRole,
          municipalityId,
          organizationId,
          mustChangePassword: true,
          credentialsChangedAt: changedAt,
        },
        select: {
          id: true,
          role: true,
          municipalityId: true,
          organizationId: true,
          sessionVersion: true,
        },
      });

      await transaction.auditLog.create({
        data: {
          actorId: admin.id,
          municipalityId: user.municipalityId,
          action: "user.created",
          entityType: "User",
          entityId: user.id,
          metadata: {
            role: user.role,
            organizationId: user.organizationId,
            mustChangePassword: true,
            sessionVersion: user.sessionVersion,
          },
        },
      });

      return "created" as const;
    }, serializableTransaction);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      duplicateEmail = true;
    } else {
      throw error;
    }
  }

  if (duplicateEmail) {
    redirect(
      teamPath(
        "error",
        "No se pudo crear la cuenta con esos datos.",
        returnPath,
      ),
    );
  }

  if (result === "unauthorized") {
    redirect(loginPath("error", "La sesión ya no es válida."));
  }

  if (result === "no-municipality") {
    redirect(
      teamPath(
        "error",
        coordinator.role === UserRole.SUPER_ADMIN
          ? "Selecciona explícitamente el municipio de la nueva cuenta."
          : "La cuenta administradora no tiene municipio.",
        returnPath,
      ),
    );
  }

  if (result === "invalid-municipality") {
    redirect(
      teamPath("error", "El municipio seleccionado no existe.", returnPath),
    );
  }

  if (result === "invalid-organization") {
    redirect(
      teamPath(
        "error",
        "La organización no pertenece al municipio seleccionado.",
        returnPath,
      ),
    );
  }

  if (result === "tenant-override") {
    redirect(
      teamPath(
        "error",
        "Una administración municipal no puede cambiar el tenant de la nueva cuenta.",
        returnPath,
      ),
    );
  }

  revalidatePath("/coordinacion/equipo");
  redirect(teamPath("notice", "Cuenta de coordinación creada.", returnPath));
}

export async function setCoordinatorStatus(formData: FormData) {
  const coordinator = await requireMunicipalAdmin();
  const returnPath = safeTeamReturnPath(formData.get("returnTo"));
  const parsed = accountStatusSchema.safeParse({
    userId: formData.get("userId"),
    statusAction: formData.get("statusAction"),
    reason: formData.get("reason"),
    currentPassword: formData.get("currentPassword"),
    confirmSensitiveAction: formData.get("confirmSensitiveAction"),
  });

  if (!parsed.success) {
    redirect(
      teamPath(
        "error",
        "Indica un motivo de al menos 8 caracteres y confirma expresamente la acción.",
        returnPath,
      ),
    );
  }

  const stepUp = await verifySensitiveAdminStepUp({
    coordinator,
    currentPassword: parsed.data.currentPassword,
    operation: `user.${parsed.data.statusAction}`,
    target: parsed.data.userId,
  });
  if (stepUp !== "verified") rejectSensitiveStepUp(stepUp, returnPath);

  const result = await prisma.$transaction(async (transaction) => {
    const admin = await getManagingAdmin(transaction, coordinator);

    if (!admin) {
      return { status: "unauthorized" } as const;
    }

    const where = manageableUserWhere(admin, parsed.data.userId);
    const user = await transaction.user.findFirst({
      where,
      select: {
        id: true,
        isActive: true,
        disabledAt: true,
        municipalityId: true,
        sessionVersion: true,
      },
    });

    if (!user) {
      return { status: "not-found" } as const;
    }

    const isActive = parsed.data.statusAction === "activate";

    if (user.isActive === isActive) {
      return { status: "no-change", isActive } as const;
    }

    const changedAt = new Date();
    const updated = await transaction.user.updateMany({
      where: {
        ...where,
        isActive: user.isActive,
        sessionVersion: user.sessionVersion,
      },
      data: {
        isActive,
        disabledAt: isActive ? null : changedAt,
        sessionVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      return { status: "not-found" } as const;
    }

    await transaction.auditLog.create({
      data: {
        actorId: admin.id,
        municipalityId: user.municipalityId,
        action: isActive ? "user.enabled" : "user.disabled",
        entityType: "User",
        entityId: user.id,
        metadata: {
          reason: parsed.data.reason,
          explicitlyConfirmed: true,
          before: {
            isActive: user.isActive,
            disabledAt: user.disabledAt?.toISOString() ?? null,
            sessionVersion: user.sessionVersion,
          },
          after: {
            isActive,
            disabledAt: isActive ? null : changedAt.toISOString(),
            sessionVersion: user.sessionVersion + 1,
          },
        },
      },
    });

    return { status: "updated", isActive } as const;
  }, serializableTransaction);

  if (result.status === "unauthorized") {
    redirect(loginPath("error", "La sesión ya no es válida."));
  }

  if (result.status === "not-found") {
    redirect(
      teamPath("error", "Cuenta no encontrada o no modificable.", returnPath),
    );
  }

  if (result.status === "no-change") {
    redirect(
      teamPath(
        "error",
        result.isActive
          ? "La cuenta ya estaba activa. Recarga antes de volver a actuar."
          : "La cuenta ya estaba inactiva. Recarga antes de volver a actuar.",
        returnPath,
      ),
    );
  }

  revalidatePath("/coordinacion/equipo");
  redirect(
    teamPath(
      "notice",
      result.isActive ? "Cuenta activada." : "Cuenta desactivada.",
      returnPath,
    ),
  );
}

export async function resetCoordinatorPassword(formData: FormData) {
  const coordinator = await requireMunicipalAdmin();
  const returnPath = safeTeamReturnPath(formData.get("returnTo"));
  const parsed = passwordResetSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
    reason: formData.get("reason"),
    currentPassword: formData.get("currentPassword"),
    confirmSensitiveAction: formData.get("confirmSensitiveAction"),
  });

  if (!parsed.success) {
    redirect(
      teamPath(
        "error",
        parsed.error.issues[0]?.message ??
          "Revisa la contraseña, el motivo y la confirmación.",
        returnPath,
      ),
    );
  }

  const stepUp = await verifySensitiveAdminStepUp({
    coordinator,
    currentPassword: parsed.data.currentPassword,
    operation: "user.password_reset",
    target: parsed.data.userId,
  });
  if (stepUp !== "verified") rejectSensitiveStepUp(stepUp, returnPath);

  const passwordHash = await hash(parsed.data.password, 12);
  const changedAt = new Date();
  const result = await prisma.$transaction(async (transaction) => {
    const admin = await getManagingAdmin(transaction, coordinator);

    if (!admin) {
      return "unauthorized" as const;
    }

    const where = manageableUserWhere(admin, parsed.data.userId);
    const user = await transaction.user.findFirst({
      where,
      select: {
        id: true,
        municipalityId: true,
        mustChangePassword: true,
        credentialsChangedAt: true,
        sessionVersion: true,
      },
    });

    if (!user) {
      return "not-found" as const;
    }

    const updated = await transaction.user.updateMany({
      where: { ...where, sessionVersion: user.sessionVersion },
      data: {
        passwordHash,
        mustChangePassword: true,
        credentialsChangedAt: changedAt,
        sessionVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      return "not-found" as const;
    }

    await transaction.auditLog.create({
      data: {
        actorId: admin.id,
        municipalityId: user.municipalityId,
        action: "user.password_reset",
        entityType: "User",
        entityId: user.id,
        metadata: {
          reason: parsed.data.reason,
          explicitlyConfirmed: true,
          passwordReplaced: true,
          before: {
            mustChangePassword: user.mustChangePassword,
            credentialsChangedAt:
              user.credentialsChangedAt?.toISOString() ?? null,
            sessionVersion: user.sessionVersion,
          },
          after: {
            mustChangePassword: true,
            credentialsChangedAt: changedAt.toISOString(),
            sessionVersion: user.sessionVersion + 1,
          },
        },
      },
    });

    return "updated" as const;
  }, serializableTransaction);

  if (result === "unauthorized") {
    redirect(loginPath("error", "La sesión ya no es válida."));
  }

  if (result === "not-found") {
    redirect(teamPath("error", "Cuenta no encontrada.", returnPath));
  }

  revalidatePath("/coordinacion/equipo");
  redirect(teamPath("notice", "Contraseña temporal actualizada.", returnPath));
}

export async function changeOwnPassword(formData: FormData) {
  const coordinator = await assertCoordinator({
    allowPasswordChangeRequired: true,
  });
  const currentPassword = currentPasswordSchema.safeParse(
    formData.get("currentPassword"),
  );
  const newPassword = passwordSchema.safeParse(formData.get("newPassword"));
  const confirmation = z
    .string()
    .max(200)
    .safeParse(formData.get("confirmation"));

  if (!currentPassword.success) {
    redirect(accountPath("error", "Revisa la contraseña actual."));
  }

  if (!newPassword.success) {
    redirect(
      accountPath(
        "error",
        newPassword.error.issues[0]?.message ?? "Contraseña no válida.",
      ),
    );
  }

  if (!confirmation.success || newPassword.data !== confirmation.data) {
    redirect(accountPath("error", "La confirmación no coincide."));
  }

  if (currentPassword.data === newPassword.data) {
    redirect(
      accountPath(
        "error",
        "La nueva contraseña debe ser distinta de la actual.",
      ),
    );
  }

  const attemptAllowed = await consumeRateLimit({
    action: "own-password-change",
    identity: coordinator.id,
    limit: 10,
    windowMinutes: sensitiveStepUpWindowMinutes,
  });
  if (!attemptAllowed) {
    redirect(
      accountPath(
        "error",
        "Demasiados intentos. Espera unos minutos antes de volver a probar.",
      ),
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      id: coordinator.id,
      isActive: true,
      disabledAt: null,
      sessionVersion: coordinator.sessionVersion,
    },
    select: {
      id: true,
      passwordHash: true,
      municipalityId: true,
      sessionVersion: true,
    },
  });

  if (!user?.passwordHash) {
    redirect(loginPath("error", "La sesión ya no es válida. Vuelve a entrar."));
  }

  if (!(await compare(currentPassword.data, user.passwordHash))) {
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        municipalityId: user.municipalityId,
        action: "auth.password_change_verification_failed",
        entityType: "User",
        entityId: user.id,
        metadata: { sessionVersion: user.sessionVersion },
      },
    });
    redirect(accountPath("error", "La contraseña actual no es correcta."));
  }

  const passwordHash = await hash(newPassword.data, 12);
  const changedAt = new Date();
  const updated = await prisma.$transaction(async (transaction) => {
    const mutation = await transaction.user.updateMany({
      where: {
        id: user.id,
        passwordHash: user.passwordHash,
        isActive: true,
        disabledAt: null,
        sessionVersion: user.sessionVersion,
      },
      data: {
        passwordHash,
        mustChangePassword: false,
        credentialsChangedAt: changedAt,
        sessionVersion: { increment: 1 },
      },
    });

    if (mutation.count !== 1) {
      return false;
    }

    await transaction.auditLog.create({
      data: {
        actorId: user.id,
        municipalityId: user.municipalityId,
        action: "user.password_changed",
        entityType: "User",
        entityId: user.id,
        metadata: {
          mustChangePassword: false,
          sessionVersion: user.sessionVersion + 1,
        },
      },
    });

    return true;
  }, serializableTransaction);

  if (!updated) {
    redirect(loginPath("error", "La sesión ya no es válida. Vuelve a entrar."));
  }

  await clearRateLimit({
    action: "own-password-change",
    identity: coordinator.id,
    windowMinutes: sensitiveStepUpWindowMinutes,
  });

  revalidatePath("/coordinacion/equipo");
  redirect(
    loginPath(
      "notice",
      "Contraseña actualizada. Inicia sesión de nuevo para continuar.",
    ),
  );
}
