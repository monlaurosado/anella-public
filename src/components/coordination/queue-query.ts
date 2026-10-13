import type {
  ContributionQueueFilters,
  ContributionCategory,
  ContributionStatus,
  IncidentQueueFilters,
  IncidentStatus,
  IncidentType,
  Priority,
} from "@/types/domain";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const QUEUE_TEXT_FILTER_MAX_LENGTH = 160 as const;

export type IncidentQueueView =
  "validation" | "active" | "help" | "monitoring" | "closed" | "all" | "custom";

export type IncidentStatusGroup =
  | ""
  | "operational"
  | "ongoing"
  | "pending_validation"
  | "active"
  | "monitoring"
  | "draft"
  | "resolved"
  | "cancelled"
  | "closed";

export type IncidentFilterState = {
  view: IncidentQueueView;
  query: string;
  status: IncidentStatusGroup;
  type: "" | IncidentType;
  priority: "" | Priority;
  municipality: string;
  organization: string;
  createdFrom: string;
  createdTo: string;
  hasPendingNeeds: boolean;
  sort: NonNullable<IncidentQueueFilters["sort"]>;
  direction: NonNullable<IncidentQueueFilters["direction"]>;
  pageSize: number;
};

export type ContributionQueueView =
  "open" | "delivered" | "exceptions" | "custom";

export type ContributionStatusGroup =
  | ""
  | "open"
  | "pledged"
  | "en_route"
  | "partially_delivered"
  | "delivered"
  | "cancelled"
  | "no_show"
  | "exceptions";

export type ContributionFilterState = {
  view: ContributionQueueView;
  query: string;
  status: ContributionStatusGroup;
  incident: string;
  safePoint: string;
  category: "" | ContributionCategory;
  eta: "" | "with_eta" | "due_soon" | "late";
  municipality: string;
  createdFrom: string;
  createdTo: string;
  pageSize: number;
};

const incidentViews = new Set<IncidentQueueView>([
  "validation",
  "active",
  "help",
  "monitoring",
  "closed",
  "all",
  "custom",
]);

const contributionViews = new Set<ContributionQueueView>([
  "open",
  "delivered",
  "exceptions",
  "custom",
]);

const contributionCategories = new Set<ContributionCategory>([
  "water",
  "food",
  "hygiene",
  "medical_supplies",
  "tools",
  "protective_equipment",
  "transport",
  "accommodation",
  "animal_support",
  "other",
]);

const etaFilters = new Set<ContributionFilterState["eta"]>([
  "",
  "with_eta",
  "due_soon",
  "late",
]);

const incidentTypes = new Set<IncidentType>([
  "wildfire",
  "flood",
  "storm",
  "earthquake",
  "snow",
  "power_outage",
  "search_rescue",
  "health",
  "industrial",
  "other",
]);

const priorities = new Set<Priority>(["low", "medium", "high", "critical"]);

const incidentStatusGroups = new Set<IncidentStatusGroup>([
  "",
  "operational",
  "ongoing",
  "pending_validation",
  "active",
  "monitoring",
  "draft",
  "resolved",
  "cancelled",
  "closed",
]);

const contributionStatusGroups = new Set<ContributionStatusGroup>([
  "",
  "open",
  "pledged",
  "en_route",
  "partially_delivered",
  "delivered",
  "cancelled",
  "no_show",
  "exceptions",
]);

const incidentStatusesByGroup: Record<
  Exclude<IncidentStatusGroup, "">,
  IncidentStatus[]
> = {
  operational: ["draft", "pending_validation", "active", "monitoring"],
  ongoing: ["active", "monitoring"],
  pending_validation: ["pending_validation"],
  active: ["active"],
  monitoring: ["monitoring"],
  draft: ["draft"],
  resolved: ["resolved"],
  cancelled: ["cancelled"],
  closed: ["resolved", "cancelled"],
};

const contributionStatusesByGroup: Record<
  Exclude<ContributionStatusGroup, "">,
  ContributionStatus[]
> = {
  open: ["pledged", "en_route", "partially_delivered"],
  pledged: ["pledged"],
  en_route: ["en_route"],
  partially_delivered: ["partially_delivered"],
  delivered: ["delivered"],
  cancelled: ["cancelled"],
  no_show: ["no_show"],
  exceptions: ["cancelled", "no_show"],
};

const pageSizes = new Set([10, 25, 50, 100]);
const maximumPage = 999_999;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function textValue(value: string | string[] | undefined) {
  return (first(value) ?? "").trim().slice(0, QUEUE_TEXT_FILTER_MAX_LENGTH);
}

function positiveInteger(value: string | string[] | undefined) {
  const raw = first(value) ?? "";
  if (!/^[1-9]\d{0,5}$/.test(raw)) return 1;
  const parsed = Number(raw);
  return parsed <= maximumPage ? parsed : 1;
}

function pageSizeValue(value: string | string[] | undefined) {
  const parsed = Number.parseInt(first(value) ?? "", 10);
  return pageSizes.has(parsed) ? parsed : 25;
}

function hasIncidentFilter(params: RawSearchParams) {
  return [
    "q",
    "status",
    "type",
    "priority",
    "municipality",
    "organization",
    "createdFrom",
    "createdTo",
    "pending",
    "sort",
    "direction",
  ].some((key) => params[key] !== undefined);
}

function hasContributionFilter(params: RawSearchParams) {
  return [
    "q",
    "status",
    "incident",
    "safePoint",
    "incidentId",
    "safePointId",
    "category",
    "eta",
    "municipality",
    "createdFrom",
    "createdTo",
  ].some((key) => params[key] !== undefined);
}

export function parseIncidentQueueQuery(params: RawSearchParams): {
  state: IncidentFilterState;
  filters: IncidentQueueFilters;
} {
  const requestedView = first(params.view);
  const view = incidentViews.has(requestedView as IncidentQueueView)
    ? (requestedView as IncidentQueueView)
    : hasIncidentFilter(params)
      ? "custom"
      : "active";

  const viewDefaults: Record<
    IncidentQueueView,
    Pick<IncidentFilterState, "status" | "priority" | "hasPendingNeeds">
  > = {
    validation: {
      status: "pending_validation",
      priority: "",
      hasPendingNeeds: false,
    },
    active: {
      status: "active",
      priority: "",
      hasPendingNeeds: false,
    },
    help: {
      status: "ongoing",
      priority: "",
      hasPendingNeeds: true,
    },
    monitoring: {
      status: "monitoring",
      priority: "",
      hasPendingNeeds: false,
    },
    closed: {
      status: "closed",
      priority: "",
      hasPendingNeeds: false,
    },
    all: {
      status: "",
      priority: "",
      hasPendingNeeds: false,
    },
    custom: {
      status: "",
      priority: "",
      hasPendingNeeds: false,
    },
  };

  const rawStatus = first(params.status) ?? "";
  const status =
    view === "custom" &&
    incidentStatusGroups.has(rawStatus as IncidentStatusGroup)
      ? (rawStatus as IncidentStatusGroup)
      : viewDefaults[view].status;

  const rawType = first(params.type) ?? "";
  const type = incidentTypes.has(rawType as IncidentType)
    ? (rawType as IncidentType)
    : "";

  const rawPriority = first(params.priority) ?? "";
  const priority =
    view === "custom" && priorities.has(rawPriority as Priority)
      ? (rawPriority as Priority)
      : viewDefaults[view].priority;

  const rawSort = first(params.sort);
  const sort = ["priority", "activity", "created"].includes(rawSort ?? "")
    ? (rawSort as NonNullable<IncidentQueueFilters["sort"]>)
    : "activity";

  const direction = first(params.direction) === "asc" ? "asc" : "desc";
  const hasPendingNeeds =
    view === "custom"
      ? first(params.pending) === "1"
      : viewDefaults[view].hasPendingNeeds;

  const state: IncidentFilterState = {
    view,
    query: textValue(params.q),
    status,
    type,
    priority,
    municipality: textValue(params.municipality),
    organization: textValue(params.organization),
    createdFrom: textValue(params.createdFrom),
    createdTo: textValue(params.createdTo),
    hasPendingNeeds,
    sort,
    direction,
    pageSize: pageSizeValue(params.pageSize),
  };

  return {
    state,
    filters: {
      query: state.query || undefined,
      statuses: state.status
        ? incidentStatusesByGroup[state.status]
        : undefined,
      types: state.type ? [state.type] : undefined,
      priorities: state.priority ? [state.priority] : undefined,
      municipality: state.municipality || undefined,
      organization: state.organization || undefined,
      createdFrom: state.createdFrom || undefined,
      createdTo: state.createdTo || undefined,
      hasPendingNeeds: state.hasPendingNeeds || undefined,
      sort: state.sort,
      direction: state.direction,
      page: positiveInteger(params.page),
      pageSize: state.pageSize,
    },
  };
}

export function parseContributionQueueQuery(params: RawSearchParams): {
  state: ContributionFilterState;
  filters: ContributionQueueFilters;
} {
  const requestedView = first(params.view);
  const view = contributionViews.has(requestedView as ContributionQueueView)
    ? (requestedView as ContributionQueueView)
    : hasContributionFilter(params)
      ? "custom"
      : "open";

  const rawStatus = first(params.status) ?? "";
  const defaultStatus: ContributionStatusGroup =
    view === "open"
      ? "open"
      : view === "delivered"
        ? "delivered"
        : view === "exceptions"
          ? "exceptions"
          : "";
  const status =
    view === "custom" &&
    contributionStatusGroups.has(rawStatus as ContributionStatusGroup)
      ? (rawStatus as ContributionStatusGroup)
      : defaultStatus;

  const state: ContributionFilterState = {
    view,
    query: textValue(params.q),
    status,
    incident: textValue(params.incident),
    safePoint: textValue(params.safePoint),
    category: contributionCategories.has(
      first(params.category) as ContributionCategory,
    )
      ? (first(params.category) as ContributionCategory)
      : "",
    eta: etaFilters.has(first(params.eta) as ContributionFilterState["eta"])
      ? (first(params.eta) as ContributionFilterState["eta"])
      : "",
    municipality: textValue(params.municipality),
    createdFrom: textValue(params.createdFrom),
    createdTo: textValue(params.createdTo),
    pageSize: pageSizeValue(params.pageSize),
  };

  return {
    state,
    filters: {
      query: state.query || undefined,
      statuses: state.status
        ? contributionStatusesByGroup[state.status]
        : undefined,
      incidentQuery: state.incident || undefined,
      safePointQuery: state.safePoint || undefined,
      category: state.category || undefined,
      eta: state.eta || undefined,
      municipality: state.municipality || undefined,
      createdFrom: state.createdFrom || undefined,
      createdTo: state.createdTo || undefined,
      // Preserve exact-id deep links from older bookmarks without loading a
      // global, unbounded list of every incident and safe point into the UI.
      incidentId: textValue(params.incidentId) || undefined,
      safePointId: textValue(params.safePointId) || undefined,
      page: positiveInteger(params.page),
      pageSize: state.pageSize,
    },
  };
}

export function copySearchParams(params: RawSearchParams) {
  const result = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (["notice", "error", "flashAt", "flashSig"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }

  return result;
}
