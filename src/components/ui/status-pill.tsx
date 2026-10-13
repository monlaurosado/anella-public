import type { IncidentStatus, NeedStatus, Priority } from "@/types/domain";
import {
  formatIncidentStatus,
  formatNeedStatus,
  formatPriority,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function PriorityPill({ priority }: { priority: Priority }) {
  const tone =
    priority === "critical" || priority === "high"
      ? "danger"
      : priority === "medium"
        ? "warning"
        : "neutral";

  return <Badge tone={tone}>{formatPriority(priority)}</Badge>;
}

export function IncidentStatusPill({ status }: { status: IncidentStatus }) {
  const tone =
    status === "active"
      ? "danger"
      : status === "monitoring"
        ? "info"
        : status === "resolved"
          ? "success"
          : "neutral";

  return <Badge tone={tone}>{formatIncidentStatus(status)}</Badge>;
}

export function NeedStatusPill({ status }: { status: NeedStatus }) {
  const tone =
    status === "active"
      ? "warning"
      : status === "covered"
        ? "success"
        : "neutral";

  return <Badge tone={tone}>{formatNeedStatus(status)}</Badge>;
}
