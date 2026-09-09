'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChargeBreakdown, Paginated } from '@smartpark/contracts';
import { api, qs } from '@/lib/api';

/** Shared data hooks for vehicles, stays, billing, releases and reporting. */

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

export interface VehicleListItem {
  id: string;
  registrationNumber: string;
  normalizedRegistrationNumber: string;
  vehicleClass: string;
  make: string | null;
  model: string | null;
  status: string;
  vahanVerificationStatus: string;
  registeredOwnerName: string | null;
  financierId: string | null;
  financierName: string | null;
  siteId: string | null;
  siteName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface VehicleDetail extends VehicleListItem {
  variant: string | null;
  color: string | null;
  fuelType: string | null;
  manufacturingYear: number | null;
  chassisNumberLast4: string | null;
  engineNumberLast4: string | null;
  registeredOwnerAddress: string | null;
  hypothecationStatus: string;
  vahanVerifiedAt: string | null;
  financierMatchMethod: string;
  financierMatchConfidence: string | null;
  ownershipSource: string | null;
  ownershipRetrievedAt: string | null;
  /** True when the ownership data came from the development simulator. */
  ownershipIsSimulated: boolean;
  activeSession: {
    id: string;
    sessionNumber: string;
    status: string;
    entryAt: string;
    exitAt: string | null;
    siteName: string;
    zoneName: string | null;
    spaceCode: string | null;
    rateUnresolved: boolean;
  } | null;
  totalVisits: number;
  notes: string | null;
}

export interface TimelineItem {
  id: string;
  type: string;
  occurredAt: string;
  title: string;
  description: string | null;
  siteName: string | null;
  actorType: string;
  actorLabel: string | null;
  payload: Record<string, unknown> | null;
  correlationId: string | null;
}

export function useVehicles(filters: Record<string, string | number | boolean | string[] | undefined>) {
  return useQuery({
    queryKey: ['vehicles', filters],
    queryFn: () => api.get<Paginated<VehicleListItem>>(`/vehicles${qs(filters)}`),
  });
}

export function useVehicle(vehicleId: string | null) {
  return useQuery({
    queryKey: ['vehicles', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    enabled: Boolean(vehicleId),
  });
}

export function useVehicleTimeline(vehicleId: string | null, pageSize = 50) {
  return useQuery({
    queryKey: ['vehicles', vehicleId, 'timeline', pageSize],
    queryFn: () => api.get<Paginated<TimelineItem>>(`/vehicles/${vehicleId}/timeline${qs({ pageSize })}`),
    enabled: Boolean(vehicleId),
  });
}

export function useVehicleSearch(term: string) {
  return useQuery({
    queryKey: ['vehicles', 'search', term],
    queryFn: () => api.get<VehicleListItem[]>(`/vehicles/search${qs({ q: term })}`),
    enabled: term.trim().length >= 2,
    staleTime: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/* Parking sessions                                                    */
/* ------------------------------------------------------------------ */

export interface SessionListItem {
  id: string;
  sessionNumber: string;
  status: string;
  parkingMode: string;
  entryAt: string;
  exitAt: string | null;
  ageingDays: number;
  rateUnresolved: boolean;
  vehicleId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  vehicleClass: string;
  vehicleStatus: string;
  siteId: string;
  siteName: string;
  financierId: string | null;
  financierName: string | null;
  zoneName: string | null;
  spaceCode: string | null;
}

export interface SessionDetail extends SessionListItem {
  contractCode: string | null;
  contractTitle: string | null;
  ratePlanCode: string | null;
  ratePlanName: string | null;
  billingUnit: string | null;
  admissionMethod: string;
  holdReason: string | null;
  closureReason: string | null;
  currentCharge: {
    subtotal: string;
    taxTotal: string;
    total: string;
    currency: string;
    chargeableUnits: string;
    explanation: string[];
  } | null;
  chargeUnavailableReason: string | null;
  allocations: Array<{
    zoneName: string;
    spaceCode: string | null;
    allocatedAt: string;
    releasedAt: string | null;
    reason: string | null;
  }>;
}

export function useSessions(
  filters: Record<string, string | number | boolean | string[] | undefined>,
  options: { refetchInterval?: number } = {},
) {
  return useQuery({
    queryKey: ['parking-sessions', filters],
    queryFn: () => api.get<Paginated<SessionListItem>>(`/parking-sessions${qs(filters)}`),
    ...(options.refetchInterval ? { refetchInterval: options.refetchInterval } : {}),
  });
}

export function useSession(sessionId: string | null) {
  return useQuery({
    queryKey: ['parking-sessions', sessionId],
    queryFn: () => api.get<SessionDetail>(`/parking-sessions/${sessionId}`),
    enabled: Boolean(sessionId),
  });
}

export function useSessionCharge(sessionId: string | null) {
  return useQuery({
    queryKey: ['parking-sessions', sessionId, 'charge'],
    queryFn: () =>
      api.get<{ breakdown: ChargeBreakdown | null; unavailableReason?: string }>(
        `/parking-sessions/${sessionId}/charge`,
      ),
    enabled: Boolean(sessionId),
  });
}

export function useSessionAction(sessionId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['parking-sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  return {
    hold: useMutation({
      mutationFn: (reason: string) => api.post(`/parking-sessions/${sessionId}/hold`, { reason }),
      onSuccess: invalidate,
    }),
    liftHold: useMutation({
      mutationFn: (reason: string) => api.post(`/parking-sessions/${sessionId}/lift-hold`, { reason }),
      onSuccess: invalidate,
    }),
    attachRate: useMutation({
      mutationFn: (reason: string) => api.post(`/parking-sessions/${sessionId}/attach-rate`, { reason }),
      onSuccess: invalidate,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Releases                                                            */
/* ------------------------------------------------------------------ */

export interface EligibilityCheck {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
  blocking: boolean;
}

export interface EligibilitySnapshot {
  checkedAt: string;
  eligible: boolean;
  checks: EligibilityCheck[];
  outstandingBalance: string | null;
  currency: string;
  finalChargeTotal: string | null;
}

export interface ReleaseListItem {
  id: string;
  requestNumber: string;
  status: string;
  requestedAt: string;
  requestedById: string;
  requestedForPartyType: string;
  approvedAt: string | null;
  completedAt: string | null;
  siteId: string;
  siteName: string;
  sessionId: string;
  sessionNumber: string;
  vehicleId: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  vehicleStatus: string;
}

export interface ReleaseDetail extends ReleaseListItem {
  reason: string;
  requestedForName: string | null;
  requestedForPhone: string | null;
  requestedForIdRef: string | null;
  rejectionReason: string | null;
  eligibility: EligibilitySnapshot | null;
  chargeCalculationId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceTotal: string | null;
  invoiceBalance: string | null;
  invoiceStatus: string | null;
  authorizationPending: boolean;
  authorizationExpiresAt: string | null;
  approvals: Array<{ approverId: string; decision: string; remarks: string | null; decidedAt: string }>;
}

export function useReleases(filters: Record<string, string | number | boolean | string[] | undefined>) {
  return useQuery({
    queryKey: ['releases', filters],
    queryFn: () => api.get<Paginated<ReleaseListItem>>(`/releases${qs(filters)}`),
  });
}

export function useRelease(releaseId: string | null) {
  return useQuery({
    queryKey: ['releases', releaseId],
    queryFn: () => api.get<ReleaseDetail>(`/releases/${releaseId}`),
    enabled: Boolean(releaseId),
  });
}

export function useEligibility(sessionId: string | null) {
  return useQuery({
    queryKey: ['releases', 'eligibility', sessionId],
    queryFn: () => api.get<EligibilitySnapshot>(`/releases/eligibility/${sessionId}`),
    enabled: Boolean(sessionId),
  });
}

export function useReleaseActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['releases'] });
    void queryClient.invalidateQueries({ queryKey: ['parking-sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  return {
    request: useMutation({
      mutationFn: (input: {
        sessionId: string;
        reason: string;
        requestedForPartyType: string;
        requestedForName?: string;
        requestedForPhone?: string;
      }) => api.post<ReleaseDetail>('/releases', input),
      onSuccess: invalidate,
    }),
    decide: useMutation({
      mutationFn: (input: { releaseId: string; decision: 'APPROVED' | 'REJECTED'; remarks: string }) =>
        api.post<{ release: ReleaseDetail; authorizationCode: string | null }>(
          `/releases/${input.releaseId}/decision`,
          { decision: input.decision, remarks: input.remarks },
        ),
      onSuccess: invalidate,
    }),
    complete: useMutation({
      mutationFn: (input: { releaseId: string; authorizationCode?: string }) =>
        api.post<{ release: ReleaseDetail; invoiceId: string | null; invoiceNumber: string | null }>(
          `/releases/${input.releaseId}/complete`,
          { authorizationCode: input.authorizationCode },
        ),
      onSuccess: invalidate,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  billingPartyType: string;
  billingPartyName: string;
  financierId: string | null;
  financierName: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  siteId: string;
  siteName: string;
  vehicleId: string | null;
  registrationNumber: string | null;
  sessionId: string | null;
  sessionNumber: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  billingPartyAddress: string | null;
  billingPartyGstin: string | null;
  billingPartyEmail: string | null;
  billingPartyPhone: string | null;
  notes: string | null;
  voidReason: string | null;
  billingRuleCode: string | null;
  billingRuleName: string | null;
  chargeCalculationId: string | null;
  chargeExplanation: string[];
  chargeInputsHash: string | null;
  chargeEngineVersion: string | null;
  lines: Array<{ lineNo: number; description: string; quantity: string; unitAmount: string; amount: string }>;
  taxLines: Array<{ sequence: number; code: string; name: string; rate: string; taxableAmount: string; amount: string }>;
  payments: Array<{ id: string; amount: string; method: string; status: string; reference: string | null; completedAt: string | null }>;
}

export function useInvoices(filters: Record<string, string | number | boolean | string[] | undefined>) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: () => api.get<Paginated<InvoiceListItem>>(`/invoices${qs(filters)}`),
  });
}

export function useInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${invoiceId}`),
    enabled: Boolean(invoiceId),
  });
}

export function useBillingActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  return {
    issue: useMutation({
      mutationFn: (invoiceId: string) => api.post<InvoiceDetail>(`/invoices/${invoiceId}/issue`),
      onSuccess: invalidate,
    }),
    voidInvoice: useMutation({
      mutationFn: (input: { invoiceId: string; reason: string }) =>
        api.post(`/invoices/${input.invoiceId}/void`, { reason: input.reason }),
      onSuccess: invalidate,
    }),
    recordPayment: useMutation({
      mutationFn: (input: {
        invoiceId: string;
        amount: string;
        method: string;
        reference?: string;
        idempotencyKey: string;
      }) => api.post('/payments', input),
      onSuccess: invalidate,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export interface DashboardSummary {
  vehiclesInYard: number;
  entriesToday: number;
  exitsToday: number;
  awaitingEnrichment: number;
  withoutContract: number;
  ageingBeyondThreshold: number;
  pendingReleases: number;
  captureReviewQueue: number;
  outstandingAmount: string;
  outstandingInvoiceCount: number;
  collectedThisMonth: string;
  openAuctions: number;
  auctionPipelineValue: string;
  currency: string;
  generatedAt: string;
}

export interface OccupancyReport {
  sites: Array<{
    siteId: string;
    siteCode: string;
    siteName: string;
    siteType: string;
    parkingMode: string;
    status: string;
    capacity: number;
    occupied: number;
    available: number;
    utilisationPercent: number;
    zones: Array<{
      zoneId: string;
      code: string;
      name: string;
      capacity: number;
      occupied: number;
      available: number;
      utilisationPercent: number;
      allowedClasses: string[];
    }>;
  }>;
  generatedAt: string;
}

export interface AgeingReport {
  buckets: Array<{ label: string; minDays: number; maxDays: number | null; count: number }>;
  totalVehicles: number;
  averageAgeDays: number;
  oldestAgeDays: number;
  generatedAt: string;
}

export interface ActivityReport {
  from: string;
  days: number;
  series: Array<{ date: string; entries: number; exits: number }>;
  generatedAt: string;
}

export interface RevenueReport {
  from: string;
  to: string;
  currency: string;
  invoicedAmount: string;
  invoiceCount: number;
  collectedAmount: string;
  outstandingAmount: string;
  outstandingCount: number;
  overdueAmount: string;
  overdueCount: number;
  byFinancier: Array<{
    financierId: string;
    financierName: string;
    invoiceCount: number;
    invoicedAmount: string;
    outstandingAmount: string;
  }>;
  generatedAt: string;
}

export function useDashboard(siteId?: string) {
  return useQuery({
    queryKey: ['reports', 'dashboard', siteId],
    queryFn: () => api.get<DashboardSummary>(`/reports/dashboard${qs({ siteId })}`),
    refetchInterval: 30_000,
  });
}

export function useOccupancy(siteId?: string) {
  return useQuery({
    queryKey: ['reports', 'occupancy', siteId],
    queryFn: () => api.get<OccupancyReport>(`/reports/occupancy${qs({ siteId })}`),
    refetchInterval: 30_000,
  });
}

export function useAgeing(siteId?: string) {
  return useQuery({
    queryKey: ['reports', 'ageing', siteId],
    queryFn: () => api.get<AgeingReport>(`/reports/ageing${qs({ siteId })}`),
  });
}

export function useActivity(days = 30, siteId?: string) {
  return useQuery({
    queryKey: ['reports', 'activity', days, siteId],
    queryFn: () => api.get<ActivityReport>(`/reports/activity${qs({ days, siteId })}`),
  });
}

export function useRevenue(siteId?: string) {
  return useQuery({
    queryKey: ['reports', 'revenue', siteId],
    queryFn: () => api.get<RevenueReport>(`/reports/revenue${qs({ siteId })}`),
  });
}
