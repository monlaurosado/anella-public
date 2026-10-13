import type { ContributionStatus } from "@/types/domain";

type ContributionQuantity = {
  quantity: number;
  deliveredQuantity: number;
  status: ContributionStatus;
};

const committedStatuses: ContributionStatus[] = [
  "pledged",
  "en_route",
  "partially_delivered",
];

export function calculateCommittedQuantity(
  contributions: ContributionQuantity[],
) {
  return contributions.reduce((total, contribution) => {
    if (!committedStatuses.includes(contribution.status)) {
      return total;
    }

    return (
      total +
      Math.max(0, contribution.quantity - contribution.deliveredQuantity)
    );
  }, 0);
}

export function calculateRemainingQuantity({
  quantityNeeded,
  quantityReceived,
  quantityCommitted,
}: {
  quantityNeeded: number;
  quantityReceived: number;
  quantityCommitted: number;
}) {
  return Math.max(0, quantityNeeded - quantityReceived - quantityCommitted);
}
