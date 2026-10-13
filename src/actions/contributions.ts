"use server";

import { updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import {
  pledgeContribution,
  type ContributionFormState,
} from "@/services/pledge-contribution";

export type { ContributionFormState } from "@/services/pledge-contribution";

export async function submitContribution(
  state: ContributionFormState,
  formData: FormData,
): Promise<ContributionFormState> {
  const result = await pledgeContribution(state, formData);

  if (!result.ok) {
    return result;
  }
  if (!result.publicCode) {
    return {
      ok: false,
      message: "No se ha podido abrir el estado privado de la aportación.",
    };
  }

  // This Server Action is the supported entry point for citizen pledges.
  // Expire the aggregate public projection before redirecting so remaining
  // quantities are never served with stale-while-revalidate semantics.
  updateTag(PUBLIC_INCIDENTS_CACHE_TAG);
  redirect(
    `/aportaciones/${encodeURIComponent(result.publicCode)}`,
    RedirectType.replace,
  );
}
