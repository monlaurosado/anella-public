import type { FireProviderStatus } from "@/lib/fire-provider-status";

export type Priority = "low" | "medium" | "high" | "critical";

export type IncidentStatus =
  | "draft"
  | "pending_validation"
  | "active"
  | "monitoring"
  | "resolved"
  | "cancelled";

export type IncidentType =
  | "wildfire"
  | "flood"
  | "storm"
  | "earthquake"
  | "snow"
  | "power_outage"
  | "search_rescue"
  | "health"
  | "industrial"
  | "other";

export type NeedType =
  | "water"
  | "food"
  | "ice"
  | "medical_supplies"
  | "transport"
  | "power"
  | "tools"
  | "shelter"
  | "volunteers"
  | "other";

export type NeedStatus =
  "draft" | "active" | "covered" | "cancelled" | "expired";

export type NeedOperationalStatus =
  | "draft"
  | "published"
  | "open"
  | "committed"
  | "en_route"
  | "partially_received"
  | "covered"
  | "expired"
  | "cancelled";

export type ContributionStatus =
  | "pledged"
  | "en_route"
  | "partially_delivered"
  | "delivered"
  | "cancelled"
  | "no_show";

export type ContributionCategory =
  | "water"
  | "food"
  | "hygiene"
  | "medical_supplies"
  | "tools"
  | "protective_equipment"
  | "transport"
  | "accommodation"
  | "animal_support"
  | "other";

export type DropOffPointType = "drop_off" | "logistics" | "collection";
export type DropOffPointStatus = "draft" | "active" | "paused" | "closed";

export type Coordinates = {
  lat: number;
  lng: number;
};

export type Municipality = {
  id: string;
  name: string;
  province?: string;
  region?: string;
};

export type PublicArea = {
  mode: "municipality_only" | "generalized_area" | "safe_points_only";
  label: string;
  coordinates?: Coordinates;
  radiusMeters?: number;
  approvedAt?: string;
};

/** Public DTO. It intentionally has no QR token or operational metadata. */
export type SafePoint = {
  id: string;
  incidentId: string;
  name: string;
  address: string;
  instructions: string;
  coordinates: Coordinates;
  radiusMeters: number;
  capacityNote?: string;
  isActive: boolean;
  pointType: DropOffPointType;
  status: DropOffPointStatus;
  publishedAt?: string;
};

export type IncidentNotice = {
  id: string;
  title: string;
  body: string;
  organizationName: string;
  publishedAt: string;
};

export type Need = {
  id: string;
  incidentId: string;
  safePointId: string;
  type: NeedType;
  title: string;
  description?: string;
  priority: Priority;
  quantityNeeded: number;
  quantityReceived: number;
  quantityCommitted: number;
  quantityEnRoute: number;
  unit: string;
  deadline?: string;
  timeZone: string;
  status: NeedStatus;
  operationalStatus: NeedOperationalStatus;
  requestingOrganizationName?: string;
  validatedByName?: string;
  validatedAt?: string;
  publishedAt?: string;
  updatedAt: string;
};

export type Contribution = {
  id: string;
  publicCode: string;
  incidentId: string;
  needId?: string;
  safePointId: string;
  category: ContributionCategory;
  description?: string;
  unit: string;
  quantity: number;
  deliveredQuantity: number;
  eta?: string;
  status: ContributionStatus;
  statusReason?: string;
  revision: number;
};

export type ExternalDetection = {
  id: string;
  source:
    | "NASA_FIRMS"
    | "EFFIS"
    | "INCENDISCAT"
    | "AEMET"
    | "METEOCAT"
    | "EMERGENCY_112"
    | "CIVIL_PROTECTION"
    | "MANUAL"
    | "OTHER";
  coordinates: Coordinates;
  detectedAt: string;
  confidence?: string;
  status: "pending" | "dismissed" | "linked";
};

export type FireSignalType = "FOREST" | "AGRICULTURAL" | "URBAN" | "THERMAL";

export type FireDetectionMapFeature = {
  type: "Feature";
  id: string;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | {
        type: "Polygon";
        coordinates: [Array<[number, number]>];
      };
  properties: {
    source: "NASA_FIRMS" | "CIVIL_PROTECTION" | "EFFIS" | "OTHER";
    provider: string;
    detectedAt: string;
    sourceUpdatedAt?: string;
    confidence?: string;
    fireType?: FireSignalType;
    providerStatus?: FireProviderStatus;
    providerStatusChangedAt?: string;
    /** Flujo interno de coordinación; ausente en la proyección pública. */
    status?: "PENDING" | "LINKED";
    satellite?: string;
    instrument?: string;
    fireRadiativePowerMw?: number;
    footprintAreaHectares?: number;
    footprintRadiusMeters: number;
    municipalityName?: string;
  };
};

export type FireDataSourceHealth = {
  sourceKey: string;
  label: string;
  status: "healthy" | "degraded" | "stale" | "pending";
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  received: number;
  imported: number;
  updated: number;
  statusChanged: number;
};

export type FireDetectionFeatureCollection = {
  type: "FeatureCollection";
  features: FireDetectionMapFeature[];
  sourceHealth: FireDataSourceHealth[];
  overallStatus: "healthy" | "degraded" | "stale" | "pending";
  generatedAt: string;
  refreshAfterSeconds: number;
};

/** Exact allow-listed projection returned to anonymous users and /api/incidents. */
export type Incident = {
  id: string;
  publicCode: string;
  title: string;
  type: IncidentType;
  status: IncidentStatus;
  priority: Priority;
  municipality: Municipality;
  responsibleOrgName: string;
  publicSummary: string;
  safetyNotice: string;
  publicArea: PublicArea;
  timeZone: string;
  updatedAt: string;
  safePoints: SafePoint[];
  needs: Need[];
  notices: IncidentNotice[];
};

export type PublicStats = {
  activeIncidents: number;
  enabledDropOffPoints: number;
  openNeeds: number;
  coveredNeeds: number;
  pledgedContributions: number;
};

export type NeedTemplate = {
  type: NeedType;
  title: string;
  unit: string;
  defaultQuantity: number;
  priority: Priority;
};

export type SafePointTemplate = {
  kind: "sports_center" | "town_hall" | "civil_protection_base";
  label: string;
  capacityHint: string;
};

export type CoordinatorSummary = {
  id: string;
  name: string;
  email: string;
  role: "COORDINATOR" | "MUNICIPAL_ADMIN" | "SUPER_ADMIN";
  municipalityId?: string;
  municipalityName?: string;
  organizationId?: string;
  organizationName?: string;
  mustChangePassword?: boolean;
};

export type ManagedContribution = Contribution & {
  citizenName: string;
  citizenPhone?: string;
  citizenEmail?: string;
  notes?: string;
  safePointId?: string;
  safePointName: string;
  safePointActive: boolean;
  needTitle: string;
  needUnit: string;
  needStatus?: NeedStatus;
  incidentId: string;
  incidentCode: string;
  incidentTitle: string;
  incidentTimeZone: string;
  municipalityName: string;
  createdAt: string;
  updatedAt: string;
  checkedInAt?: string;
};

export type ManagedSafePoint = SafePoint & {
  qrToken: string;
  updatedAt: string;
  validatedAt?: string;
  validatedByName?: string;
  associatedNeeds: number;
  activeNeeds: number;
  pendingDeliveries: number;
  deactivatedAt?: string;
  deactivationReason?: string;
};

export type ManagedNeed = Need & {
  requestingOrganizationId?: string;
  requestedByName?: string;
  cancellationReason?: string;
  cancelledAt?: string;
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorName: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ManagedIncidentTab =
  "summary" | "needs" | "contributions" | "safe-points" | "activity";

export type ManagedIncidentDetailOptions = {
  tab?: ManagedIncidentTab;
  page?: number;
  pageSize?: number;
  contributionStatus?: "all" | ContributionStatus;
};

export type ManagedIncidentCounts = {
  needs: number;
  contributions: number;
  contributionStatuses: Record<ContributionStatus, number>;
  safePoints: number;
  activity: number;
};

export type ManagedIncidentPagination = {
  tab: ManagedIncidentTab;
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export type ManagedSafePointOption = {
  id: string;
  name: string;
  isActive: boolean;
  validatedAt?: string;
};

export type ManagedNeedOption = {
  id: string;
  title: string;
  safePointId: string;
  safePointName: string;
  safePointActive: boolean;
  type: NeedType;
  unit: string;
  status: NeedStatus;
  operationalStatus: NeedOperationalStatus;
  quantityNeeded: number;
  quantityReceived: number;
  quantityCommitted: number;
  deadline?: string;
};

export type ManagedIncident = Omit<Incident, "safePoints" | "needs"> & {
  origin: "manual" | "detection_candidate" | "official_notice";
  affectedMunicipalities: Municipality[];
  isPubliclyVisible: boolean;
  publicPreview?: {
    isVisible: boolean;
    blockers: string[];
    incident: Incident;
  };
  description?: string;
  operationalCoordinates: Coordinates;
  operationalRadiusMeters: number;
  organizationId?: string;
  organizationName?: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedByName?: string;
  closedAt?: string;
  closedReason?: string;
  lastActivityAt: string;
  publicLocationApprovedByName?: string;
  safePoints: ManagedSafePoint[];
  needs: ManagedNeed[];
  contributions: ManagedContribution[];
  recentContributions: ManagedContribution[];
  activity: AuditEntry[];
  counts: ManagedIncidentCounts;
  pagination: ManagedIncidentPagination;
  safePointOptions: ManagedSafePointOption[];
  needOptions: ManagedNeedOption[];
};

export type CoordinationSnapshot = {
  incidents: IncidentQueueItem[];
  stats: PublicStats;
  pendingDetections: number;
  recentContributions: ManagedContribution[];
  currentUser: CoordinatorSummary;
};

export type IncidentQueueItem = {
  id: string;
  publicCode: string;
  title: string;
  type: IncidentType;
  status: IncidentStatus;
  priority: Priority;
  municipalityName: string;
  organizationName: string;
  openNeeds: number;
  pendingDeliveries: number;
  timeZone: string;
  lastActivityAt: string;
  createdAt: string;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export type IncidentQueueFilters = {
  query?: string;
  statuses?: IncidentStatus[];
  types?: IncidentType[];
  priorities?: Priority[];
  municipality?: string;
  organization?: string;
  createdFrom?: string;
  createdTo?: string;
  hasPendingNeeds?: boolean;
  sort?: "priority" | "activity" | "created";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type ContributionQueueFilters = {
  query?: string;
  statuses?: ContributionStatus[];
  incidentId?: string;
  safePointId?: string;
  incidentQuery?: string;
  safePointQuery?: string;
  category?: ContributionCategory;
  eta?: "with_eta" | "due_soon" | "late";
  municipality?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: number;
  pageSize?: number;
};
