'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Paginated } from '@smartpark/contracts';
import { api, qs } from '@/lib/api';

/**
 * Gate console data.
 *
 * Live behaviour is polled rather than pushed. That is a deliberate choice for
 * this phase: the API has a transactional outbox but no websocket transport
 * yet, and a 5-second poll on a screen an operator is actively watching is
 * both sufficient and honest. The interval is set once, here, so it cannot
 * drift screen by screen into something aggressive.
 *
 * Polling stops when the tab is hidden (TanStack Query's default), so a
 * forgotten tab does not hammer the API all night.
 */
export const GATE_POLL_MS = 5_000;

export interface AnprDevice {
  id: string;
  code: string;
  name: string;
  provider: string;
  direction: string;
  status: string;
  siteName: string;
  gateCode: string | null;
  lastEventAt: string | null;
  lastHeartbeatAt: string | null;
  appearsStale: boolean;
  totalEvents: number;
  confidenceThreshold: string | null;
}

export interface AnprEventItem {
  id: string;
  capturedAt: string;
  receivedAt: string;
  plateNumberRaw: string;
  normalizedPlate: string;
  correctedPlate: string | null;
  confidence: string;
  direction: string;
  status: string;
  deviceCode: string;
  deviceName: string;
  siteName: string;
  gateCode: string | null;
  vehicleId: string | null;
  vehicleDescription: string | null;
  processingError: string | null;
}

export interface GateDecision {
  outcome: string;
  vehicleId: string | null;
  sessionId: string | null;
  registrationNumber: string;
  message: string;
  blockers: string[];
  trace: string[];
  rateResolved: boolean;
  financierName: string | null;
  contractCode: string | null;
}

export interface IngestResult {
  anprEventId: string;
  status: string;
  decision: GateDecision | null;
  reviewReason: string | null;
  duplicateOf?: string;
}

export function useAnprDevices() {
  return useQuery({
    queryKey: ['anpr', 'devices'],
    queryFn: () => api.get<AnprDevice[]>('/anpr/devices'),
    refetchInterval: GATE_POLL_MS * 4,
  });
}

export function useRecentCaptures(siteId?: string, pageSize = 15) {
  return useQuery({
    queryKey: ['anpr', 'events', siteId, pageSize],
    queryFn: () =>
      api.get<Paginated<AnprEventItem>>(`/anpr/events${qs({ siteId, pageSize })}`),
    refetchInterval: GATE_POLL_MS,
  });
}

export function useReviewQueue(pageSize = 20) {
  return useQuery({
    queryKey: ['anpr', 'review-queue', pageSize],
    queryFn: () => api.get<Paginated<AnprEventItem>>(`/anpr/review-queue${qs({ pageSize })}`),
    refetchInterval: GATE_POLL_MS * 2,
  });
}

/** Development only: drives the full gate workflow without camera hardware. */
export function useSimulateCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      deviceCode: string;
      plateNumber: string;
      direction?: string;
      confidence?: number;
      vehicleClassHint?: string;
    }) => api.post<IngestResult>('/anpr/simulate', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['anpr'] });
      void queryClient.invalidateQueries({ queryKey: ['parking-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useResolveReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      anprEventId: string;
      correctedPlate: string;
      notes: string;
      reject?: boolean;
    }) =>
      api.post<IngestResult>(`/anpr/events/${input.anprEventId}/review`, {
        correctedPlate: input.correctedPlate,
        notes: input.notes,
        reject: input.reject,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['anpr'] });
      void queryClient.invalidateQueries({ queryKey: ['parking-sessions'] });
    },
  });
}
