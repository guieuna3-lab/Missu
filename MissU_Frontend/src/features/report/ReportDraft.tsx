import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ItemCategory, Place } from '@/lib/activity/types';

// Carries the multi-step forms of 04 (lost report) and 05 (found item) between their
// screens. Date and time stay as typed text until the step is submitted, so going back
// shows exactly what the member entered.
export type LostDraft = {
  /** Set when editing an existing report from 01.08. */
  editingId?: string;
  category: ItemCategory;
  name: string;
  feature: string;
  fromText: string;
  toText: string;
  place?: Place;
};

export type FoundDraft = {
  /** Set when editing a registered item from 01.07 (Figma 05.02-A). */
  editingId?: string;
  category: ItemCategory;
  name: string;
  foundAtText: string;
  place?: Place;
  photos: number;
  attachments?: { id: string; preview: string }[];
  storage: string;
  pickupGuide: string;
  privateFeature: string;
};

// Figma 04.02 and 05.01 open with 전자기기 selected.
export const emptyLostDraft: LostDraft = {
  category: 'ELECTRONICS',
  name: '',
  feature: '',
  fromText: '',
  toText: '',
};

export const emptyFoundDraft: FoundDraft = {
  category: 'ELECTRONICS',
  name: '',
  foundAtText: '',
  photos: 0,
  storage: '',
  pickupGuide: '',
  privateFeature: '',
};

type ReportDraftState = {
  lost: LostDraft;
  updateLost: (patch: Partial<LostDraft>) => void;
  resetLost: (initial?: LostDraft) => void;
  found: FoundDraft;
  updateFound: (patch: Partial<FoundDraft>) => void;
  resetFound: (initial?: FoundDraft) => void;
};

const ReportDraftContext = createContext<ReportDraftState | null>(null);

export function ReportDraftProvider({ children }: { children: ReactNode }) {
  const [lost, setLost] = useState(emptyLostDraft);
  const [found, setFound] = useState(emptyFoundDraft);
  const updateLost = useCallback(
    (patch: Partial<LostDraft>) => setLost((current) => ({ ...current, ...patch })),
    [],
  );
  const resetLost = useCallback((initial: LostDraft = emptyLostDraft) => setLost(initial), []);
  const updateFound = useCallback(
    (patch: Partial<FoundDraft>) => setFound((current) => ({ ...current, ...patch })),
    [],
  );
  const resetFound = useCallback((initial: FoundDraft = emptyFoundDraft) => setFound(initial), []);
  const value = useMemo(
    () => ({ lost, updateLost, resetLost, found, updateFound, resetFound }),
    [lost, updateLost, resetLost, found, updateFound, resetFound],
  );
  return <ReportDraftContext.Provider value={value}>{children}</ReportDraftContext.Provider>;
}

export function useReportDraft() {
  const value = useContext(ReportDraftContext);
  if (!value) throw new Error('ReportDraftProvider is required');
  return value;
}
