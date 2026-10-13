"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ContributionFormState } from "@/actions/contributions";

export type ContributionDraftValues = {
  category: string;
  description: string;
  citizenEmail: string;
  citizenName: string;
  citizenPhone: string;
  eta: string;
  etaOccurrence: "reject" | "earlier" | "later";
  notes: string;
  privacyConsent: boolean;
  followUpConsent: boolean;
  quantity: string;
  unit: string;
};

type ContributionDraftSnapshot = {
  formState?: ContributionFormState;
  values?: ContributionDraftValues;
};

type ContributionDraftStore = {
  busyNeedId: string | null;
  clearSnapshot: (needId: string) => void;
  getSnapshot: (needId: string) => ContributionDraftSnapshot | undefined;
  saveFormState: (needId: string, state: ContributionFormState) => void;
  saveValues: (needId: string, values: ContributionDraftValues) => void;
  setBusy: (needId: string, busy: boolean) => void;
};

const fallbackStore: ContributionDraftStore = {
  busyNeedId: null,
  clearSnapshot: () => undefined,
  getSnapshot: () => undefined,
  saveFormState: () => undefined,
  saveValues: () => undefined,
  setBusy: () => undefined,
};

const ContributionDraftContext =
  createContext<ContributionDraftStore>(fallbackStore);

export function ContributionDraftProvider({
  children,
}: {
  children: ReactNode;
}) {
  const snapshotsRef = useRef(new Map<string, ContributionDraftSnapshot>());
  const [busyNeedId, setBusyNeedId] = useState<string | null>(null);

  const getSnapshot = useCallback(
    (needId: string) => snapshotsRef.current.get(needId),
    [],
  );
  const clearSnapshot = useCallback((needId: string) => {
    snapshotsRef.current.delete(needId);
  }, []);
  const saveValues = useCallback(
    (needId: string, values: ContributionDraftValues) => {
      const current = snapshotsRef.current.get(needId);
      snapshotsRef.current.set(needId, { ...current, values });
    },
    [],
  );
  const saveFormState = useCallback(
    (needId: string, formState: ContributionFormState) => {
      if (formState.ok) {
        snapshotsRef.current.delete(needId);
        return;
      }
      const current = snapshotsRef.current.get(needId);
      snapshotsRef.current.set(needId, {
        ...current,
        formState,
        values: current?.values,
      });
    },
    [],
  );
  const setBusy = useCallback((needId: string, busy: boolean) => {
    setBusyNeedId((current) => {
      if (busy) return needId;
      return current === needId ? null : current;
    });
  }, []);

  const store = useMemo<ContributionDraftStore>(
    () => ({
      busyNeedId,
      clearSnapshot,
      getSnapshot,
      saveFormState,
      saveValues,
      setBusy,
    }),
    [
      busyNeedId,
      clearSnapshot,
      getSnapshot,
      saveFormState,
      saveValues,
      setBusy,
    ],
  );

  useEffect(() => {
    if (!busyNeedId) return;

    function blockAnchorNavigation(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.hasAttribute("data-contribution-recovery") ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function blockUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    document.addEventListener("click", blockAnchorNavigation, true);
    window.addEventListener("beforeunload", blockUnload);

    return () => {
      document.removeEventListener("click", blockAnchorNavigation, true);
      window.removeEventListener("beforeunload", blockUnload);
    };
  }, [busyNeedId]);

  return (
    <ContributionDraftContext.Provider value={store}>
      {children}
    </ContributionDraftContext.Provider>
  );
}

export function useContributionDraftStore() {
  return useContext(ContributionDraftContext);
}
