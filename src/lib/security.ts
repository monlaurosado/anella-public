export const roleCapabilities = {
  CITIZEN: ["view_public_incidents", "pledge_contribution"],
  COORDINATOR: [
    "view_public_incidents",
    "create_incident",
    "manage_safe_points",
    "manage_needs",
    "validate_contributions",
  ],
  MUNICIPAL_ADMIN: [
    "view_public_incidents",
    "create_incident",
    "manage_safe_points",
    "manage_needs",
    "validate_contributions",
    "manage_coordinators",
    "view_municipal_stats",
  ],
  SUPER_ADMIN: [
    "view_public_incidents",
    "create_incident",
    "manage_safe_points",
    "manage_needs",
    "validate_contributions",
    "manage_coordinators",
    "view_municipal_stats",
    "manage_all_municipalities",
  ],
} as const;

export type Role = keyof typeof roleCapabilities;
export type Capability = (typeof roleCapabilities)[Role][number];

export function can(role: Role, capability: Capability) {
  return roleCapabilities[role].includes(capability as never);
}
