-- ---------------------------------------------------------------------------
-- Integrity guards that the Prisma schema language cannot express.
--
-- Everything here is a correctness control that must hold even if application
-- code is wrong, bypassed, or run concurrently:
--
--   1. Extensions
--   2. CHECK constraints        - money, durations and ranges cannot be absurd
--   3. Partial unique indexes   - "only one live X" rules, enforced under
--                                 concurrency without application locking
--   4. Search indexes           - trigram indexes for plate / name search
--   5. Immutability triggers    - append-only tables and immutable bids and
--                                 issued invoices
--
-- Requirements covered: S26 (constraints, referential integrity, index
-- strategy), S40 (concurrency), S55 (data consistency), S19 (auction security),
-- S27 (audit trail cannot be rewritten).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. EXTENSIONS
-- ===========================================================================
-- Also created by docker/postgres/init, but repeated here so a database
-- provisioned by any other means (RDS, a DBA, CI) is set up identically.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ===========================================================================
-- 2. CHECK CONSTRAINTS
-- ===========================================================================

-- --- Sites & topology ------------------------------------------------------
ALTER TABLE "sites"
  ADD CONSTRAINT "sites_capacity_non_negative" CHECK ("totalCapacity" >= 0);

ALTER TABLE "parking_zones"
  ADD CONSTRAINT "parking_zones_capacity_non_negative" CHECK ("capacity" >= 0);

-- --- Users ----------------------------------------------------------------
-- Email is stored lowercase so the unique index is genuinely case-insensitive.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "users"
  ADD CONSTRAINT "users_failed_attempts_non_negative" CHECK ("failedLoginAttempts" >= 0);

-- --- Vehicles -------------------------------------------------------------
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_normalized_plate_format"
  CHECK ("normalizedRegistrationNumber" ~ '^[A-Z0-9]{4,16}$');

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_match_confidence_range"
  CHECK ("financierMatchConfidence" IS NULL
         OR ("financierMatchConfidence" >= 0 AND "financierMatchConfidence" <= 1));

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_seen_window_ordered" CHECK ("lastSeenAt" >= "firstSeenAt");

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_total_visits_non_negative" CHECK ("totalVisits" >= 0);

-- --- ANPR -----------------------------------------------------------------
ALTER TABLE "anpr_events"
  ADD CONSTRAINT "anpr_events_confidence_range"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "anpr_devices"
  ADD CONSTRAINT "anpr_devices_threshold_range"
  CHECK ("confidenceThreshold" IS NULL
         OR ("confidenceThreshold" >= 0 AND "confidenceThreshold" <= 1));

-- --- Contracts & rating ---------------------------------------------------
ALTER TABLE "contract_versions"
  ADD CONSTRAINT "contract_versions_period_ordered"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "contract_versions"
  ADD CONSTRAINT "contract_versions_payment_terms_non_negative"
  CHECK ("paymentTermsDays" >= 0);

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_period_ordered"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_free_units_non_negative" CHECK ("freeUnits" >= 0);

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_grace_non_negative" CHECK ("graceMinutes" >= 0);

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_minimum_charge_non_negative"
  CHECK ("minimumChargeAmount" IS NULL OR "minimumChargeAmount" >= 0);

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_daily_cap_non_negative"
  CHECK ("dailyCapAmount" IS NULL OR "dailyCapAmount" >= 0);

-- A rate plan hangs off exactly one authority: a contract version, or a site.
ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_scope_exclusive"
  CHECK (
    ("scope" = 'CONTRACT'    AND "contractVersionId" IS NOT NULL)
    OR
    ("scope" = 'SITE_TARIFF' AND "siteId" IS NOT NULL AND "contractVersionId" IS NULL)
  );

ALTER TABLE "rate_slabs"
  ADD CONSTRAINT "rate_slabs_from_unit_positive" CHECK ("fromUnit" >= 0);

ALTER TABLE "rate_slabs"
  ADD CONSTRAINT "rate_slabs_range_ordered"
  CHECK ("toUnit" IS NULL OR "toUnit" >= "fromUnit");

ALTER TABLE "rate_slabs"
  ADD CONSTRAINT "rate_slabs_amount_non_negative" CHECK ("amount" >= 0);

ALTER TABLE "tax_components"
  ADD CONSTRAINT "tax_components_rate_non_negative" CHECK ("rate" >= 0);

-- --- Parking sessions -----------------------------------------------------
ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_exit_after_entry"
  CHECK ("exitAt" IS NULL OR "exitAt" >= "entryAt");

-- A closed stay must know when it ended; an open one must not claim to.
ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_closed_has_exit"
  CHECK (
    ("status" = 'CLOSED' AND "exitAt" IS NOT NULL)
    OR ("status" <> 'CLOSED')
  );

ALTER TABLE "parking_sessions"
  ADD CONSTRAINT "parking_sessions_open_has_no_exit"
  CHECK ("status" IN ('CLOSED', 'CANCELLED') OR "exitAt" IS NULL);

-- --- Charge calculations --------------------------------------------------
ALTER TABLE "charge_calculations"
  ADD CONSTRAINT "charge_calculations_units_non_negative"
  CHECK ("totalUnits" >= 0 AND "freeUnits" >= 0 AND "chargeableUnits" >= 0);

ALTER TABLE "charge_calculations"
  ADD CONSTRAINT "charge_calculations_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0);

-- The engine must be self-consistent: total is exactly subtotal + tax.
ALTER TABLE "charge_calculations"
  ADD CONSTRAINT "charge_calculations_total_is_sum"
  CHECK ("total" = "subtotal" + "taxTotal");

ALTER TABLE "charge_calculations"
  ADD CONSTRAINT "charge_calculations_duration_non_negative"
  CHECK ("rawDurationMinutes" >= 0 AND "graceMinutes" >= 0);

-- --- Invoicing ------------------------------------------------------------
-- Credit notes are the only documents allowed to carry negative amounts.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amounts_sign"
  CHECK (
    "type" = 'CREDIT_NOTE'
    OR ("subtotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0 AND "amountPaid" >= 0)
  );

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_total_is_sum" CHECK ("total" = "subtotal" + "taxTotal");

-- The stored balance must always agree with total - paid. Any code path that
-- updates one without the other fails loudly instead of silently corrupting
-- the receivables ledger.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_balance_consistent" CHECK ("balance" = "total" - "amountPaid");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_no_overpayment"
  CHECK ("type" = 'CREDIT_NOTE' OR "amountPaid" <= "total");

-- The bill-to party must actually be identified.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_billing_party_present"
  CHECK (
    ("billingPartyType" = 'FINANCIER' AND "financierId" IS NOT NULL)
    OR ("billingPartyType" = 'BIDDER' AND "bidderId" IS NOT NULL)
    OR ("billingPartyType" IN ('CUSTOMER', 'OTHER'))
  );

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_due_after_issue"
  CHECK ("dueDate" IS NULL OR "issueDate" IS NULL OR "dueDate" >= "issueDate");

-- An issued invoice must carry an issue date, and vice versa.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_issued_has_date"
  CHECK (
    "status" NOT IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID')
    OR ("issueDate" IS NOT NULL AND "issuedAt" IS NOT NULL)
  );

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_amount_finite" CHECK ("quantity" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- --- Release --------------------------------------------------------------
ALTER TABLE "release_requests"
  ADD CONSTRAINT "release_requests_approval_exclusive"
  CHECK (NOT ("approvedById" IS NOT NULL AND "rejectedById" IS NOT NULL));

-- A rejection must state why.
ALTER TABLE "release_requests"
  ADD CONSTRAINT "release_requests_rejection_has_reason"
  CHECK ("status" <> 'REJECTED' OR "rejectionReason" IS NOT NULL);

-- --- Auction --------------------------------------------------------------
ALTER TABLE "auctions"
  ADD CONSTRAINT "auctions_window_ordered"
  CHECK ("scheduledEndAt" > "scheduledStartAt");

ALTER TABLE "auctions"
  ADD CONSTRAINT "auctions_increment_positive" CHECK ("defaultMinIncrement" > 0);

ALTER TABLE "auction_lots"
  ADD CONSTRAINT "auction_lots_reserve_non_negative" CHECK ("reservePrice" >= 0);

ALTER TABLE "auction_lots"
  ADD CONSTRAINT "auction_lots_increment_positive" CHECK ("minIncrement" > 0);

ALTER TABLE "auction_lots"
  ADD CONSTRAINT "auction_lots_bid_count_non_negative" CHECK ("bidCount" >= 0);

-- A winner and a winning bid are set together, never one without the other.
ALTER TABLE "auction_lots"
  ADD CONSTRAINT "auction_lots_winner_consistent"
  CHECK (
    ("winningBidId" IS NULL AND "winnerBidderId" IS NULL)
    OR ("winningBidId" IS NOT NULL AND "winnerBidderId" IS NOT NULL)
  );

ALTER TABLE "bids"
  ADD CONSTRAINT "bids_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "bids"
  ADD CONSTRAINT "bids_sequence_positive" CHECK ("sequenceNo" > 0);

ALTER TABLE "auction_settlements"
  ADD CONSTRAINT "auction_settlements_amounts_non_negative"
  CHECK ("saleAmount" >= 0 AND "feesAmount" >= 0 AND "taxAmount" >= 0
         AND "totalPayable" >= 0 AND "amountReceived" >= 0);

ALTER TABLE "auction_settlements"
  ADD CONSTRAINT "auction_settlements_total_is_sum"
  CHECK ("totalPayable" = "saleAmount" + "feesAmount" + "taxAmount");

ALTER TABLE "auction_settlements"
  ADD CONSTRAINT "auction_settlements_no_overpayment"
  CHECK ("amountReceived" <= "totalPayable");

ALTER TABLE "auction_registrations"
  ADD CONSTRAINT "auction_registrations_deposit_non_negative" CHECK ("depositPaid" >= 0);

-- --- Notifications, documents, jobs ---------------------------------------
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts_bounded"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_size_positive" CHECK ("sizeBytes" > 0);

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_checksum_format" CHECK ("checksumSha256" ~ '^[a-f0-9]{64}$');

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_bounded"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

ALTER TABLE "job_runs"
  ADD CONSTRAINT "job_runs_counts_non_negative"
  CHECK ("itemsProcessed" >= 0 AND "itemsFailed" >= 0);

ALTER TABLE "vehicle_registry_lookups"
  ADD CONSTRAINT "registry_lookups_attempt_bounded"
  CHECK ("attempt" >= 1 AND "maxAttempts" >= 1);

-- ===========================================================================
-- 3. PARTIAL UNIQUE INDEXES  ("only one live X")
-- ===========================================================================
-- These are the concurrency backbone. Requirement S40: two gates detecting the
-- same vehicle, or two users releasing it, must not both succeed. A unique
-- index makes the second writer fail at the database, which no amount of
-- application-level checking can guarantee.

-- At most one non-terminal parking session per vehicle, anywhere in the estate.
CREATE UNIQUE INDEX "uq_parking_sessions_one_active_per_vehicle"
  ON "parking_sessions" ("vehicleId")
  WHERE "status" IN ('OPEN', 'ON_HOLD', 'PENDING_EXIT');

-- At most one occupied space assignment at a time.
CREATE UNIQUE INDEX "uq_parking_sessions_one_active_per_space"
  ON "parking_sessions" ("spaceId")
  WHERE "spaceId" IS NOT NULL AND "status" IN ('OPEN', 'ON_HOLD', 'PENDING_EXIT');

-- Exactly one open allocation per space.
CREATE UNIQUE INDEX "uq_parking_allocations_one_open_per_space"
  ON "parking_allocations" ("spaceId")
  WHERE "spaceId" IS NOT NULL AND "releasedAt" IS NULL;

-- One current ownership snapshot per vehicle.
CREATE UNIQUE INDEX "uq_ownership_records_one_current_per_vehicle"
  ON "vehicle_ownership_records" ("vehicleId")
  WHERE "isCurrent" = true;

-- One open financier assignment per vehicle.
CREATE UNIQUE INDEX "uq_financier_history_one_open_per_vehicle"
  ON "vehicle_financier_history" ("vehicleId")
  WHERE "effectiveTo" IS NULL;

-- One current charge calculation per session.
CREATE UNIQUE INDEX "uq_charge_calculations_one_current_per_session"
  ON "charge_calculations" ("sessionId")
  WHERE "isCurrent" = true;

-- One in-flight release request per session: no double release.
CREATE UNIQUE INDEX "uq_release_requests_one_active_per_session"
  ON "release_requests" ("sessionId")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'ELIGIBILITY_FAILED',
                     'AWAITING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED');

-- A vehicle may sit in only one live auction lot at a time. UNSOLD and
-- WITHDRAWN are excluded so an unsold vehicle can be relisted later.
CREATE UNIQUE INDEX "uq_auction_lots_one_live_per_vehicle"
  ON "auction_lots" ("vehicleId")
  WHERE "status" IN ('DRAFT', 'LISTED', 'BIDDING_OPEN', 'BIDDING_CLOSED',
                     'WINNER_SELECTED', 'SETTLEMENT_PENDING', 'SETTLED');

-- One default tax profile per organisation.
CREATE UNIQUE INDEX "uq_tax_profiles_one_default_per_org"
  ON "tax_profiles" ("organizationId")
  WHERE "isDefault" = true;

-- One primary contact per financier.
CREATE UNIQUE INDEX "uq_financier_contacts_one_primary"
  ON "financier_contacts" ("financierId")
  WHERE "isPrimary" = true;

-- At most one ACTIVE version per contract at any moment. Overlapping effective
-- windows are additionally validated in the application, which can produce a
-- helpful error; this index is the last line of defence.
CREATE UNIQUE INDEX "uq_contract_versions_one_active_per_contract"
  ON "contract_versions" ("contractId")
  WHERE "status" = 'ACTIVE';

-- ===========================================================================
-- 4. SEARCH & REPORTING INDEXES
-- ===========================================================================

-- Requirement S31/S57: global search must be fast on partial plates. A trigram
-- GIN index serves `LIKE '%1234%'` and similarity ranking, which a plain B-tree
-- cannot.
CREATE INDEX "idx_vehicles_plate_trgm"
  ON "vehicles" USING GIN ("normalizedRegistrationNumber" gin_trgm_ops);

CREATE INDEX "idx_financiers_display_name_trgm"
  ON "financiers" USING GIN ("displayName" gin_trgm_ops);

CREATE INDEX "idx_bidders_display_name_trgm"
  ON "bidders" USING GIN ("displayName" gin_trgm_ops);

CREATE INDEX "idx_vehicles_make_model_trgm"
  ON "vehicles" USING GIN (
    (coalesce("make", '') || ' ' || coalesce("model", '')) gin_trgm_ops
  );

CREATE INDEX "idx_invoices_number_trgm"
  ON "invoices" USING GIN ("invoiceNumber" gin_trgm_ops);

-- Financier-portal reads always filter by financier; this covering index keeps
-- that path from touching other financiers' rows at all.
CREATE INDEX "idx_vehicles_financier_lastseen"
  ON "vehicles" ("currentFinancierId", "lastSeenAt" DESC)
  WHERE "currentFinancierId" IS NOT NULL;

-- Occupancy and ageing dashboards.
CREATE INDEX "idx_parking_sessions_open_by_site"
  ON "parking_sessions" ("siteId", "entryAt")
  WHERE "status" IN ('OPEN', 'ON_HOLD', 'PENDING_EXIT');

-- Receivables ageing.
CREATE INDEX "idx_invoices_outstanding"
  ON "invoices" ("organizationId", "dueDate")
  WHERE "status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID');

-- The ANPR review queue.
CREATE INDEX "idx_anpr_events_review_queue"
  ON "anpr_events" ("siteId", "receivedAt")
  WHERE "status" = 'PENDING_REVIEW';

-- Outbox and notification relays poll these constantly.
CREATE INDEX "idx_outbox_pending_due"
  ON "outbox_events" ("nextAttemptAt")
  WHERE "status" = 'PENDING';

CREATE INDEX "idx_notifications_retry_due"
  ON "notifications" ("nextRetryAt")
  WHERE "status" IN ('QUEUED', 'FAILED');

CREATE INDEX "idx_registry_lookups_retry_due"
  ON "vehicle_registry_lookups" ("nextRetryAt")
  WHERE "status" IN ('QUEUED', 'FAILED');

-- ===========================================================================
-- 5. IMMUTABILITY TRIGGERS
-- ===========================================================================

-- Blanket append-only guard.
CREATE OR REPLACE FUNCTION smartpark_forbid_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table "%" is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001',
          HINT = 'Insert a compensating record instead of altering history.';
END;
$$;

COMMENT ON FUNCTION smartpark_forbid_mutation() IS
  'Rejects UPDATE and DELETE on append-only tables (audit trail, timelines, approval logs).';

-- The audit trail must be tamper-evident (requirement S27).
CREATE TRIGGER "trg_audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION smartpark_forbid_mutation();

-- The vehicle timeline is the legal history of a vehicle's stay (S25).
CREATE TRIGGER "trg_timeline_events_append_only"
  BEFORE UPDATE OR DELETE ON "vehicle_timeline_events"
  FOR EACH ROW EXECUTE FUNCTION smartpark_forbid_mutation();

-- Release approvals record who authorised handing over a repossessed asset.
CREATE TRIGGER "trg_release_approvals_append_only"
  BEFORE UPDATE OR DELETE ON "release_approvals"
  FOR EACH ROW EXECUTE FUNCTION smartpark_forbid_mutation();

-- Bid status history.
CREATE TRIGGER "trg_bid_events_append_only"
  BEFORE UPDATE OR DELETE ON "bid_events"
  FOR EACH ROW EXECUTE FUNCTION smartpark_forbid_mutation();

-- Login attempts feed the security audit.
CREATE TRIGGER "trg_login_attempts_append_only"
  BEFORE UPDATE OR DELETE ON "login_attempts"
  FOR EACH ROW EXECUTE FUNCTION smartpark_forbid_mutation();

-- --- Bids -----------------------------------------------------------------
-- Requirement S18/S19: "Never overwrite bid history. Bids are immutable
-- business records." Only `status` may advance; nothing else may ever change,
-- and a bid can never be deleted - not even by an auction administrator.
CREATE OR REPLACE FUNCTION smartpark_bids_immutability_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bid % cannot be deleted: bids are immutable records', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."lotId"      IS DISTINCT FROM OLD."lotId"
  OR NEW."bidderId"   IS DISTINCT FROM OLD."bidderId"
  OR NEW."amount"     IS DISTINCT FROM OLD."amount"
  OR NEW."currency"   IS DISTINCT FROM OLD."currency"
  OR NEW."sequenceNo" IS DISTINCT FROM OLD."sequenceNo"
  OR NEW."placedAt"   IS DISTINCT FROM OLD."placedAt"
  OR NEW."channel"    IS DISTINCT FROM OLD."channel"
  OR NEW."createdAt"  IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION
      'Bid % is immutable: only "status" may change (attempted change to bid identity or amount)',
      OLD."id"
      USING ERRCODE = 'P0001',
            HINT = 'Retract the bid by setting status = RETRACTED and record the reason in bid_events.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_bids_immutable"
  BEFORE UPDATE OR DELETE ON "bids"
  FOR EACH ROW EXECUTE FUNCTION smartpark_bids_immutability_guard();

-- --- Invoices -------------------------------------------------------------
-- Once an invoice is a committed financial document its identity and monetary
-- values are frozen. Corrections go through VOID + credit note, which leaves an
-- auditable trail, rather than a silent edit.
CREATE OR REPLACE FUNCTION smartpark_invoices_immutability_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoice % cannot be deleted: void it instead', OLD."invoiceNumber"
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID') THEN
    IF NEW."invoiceNumber"    IS DISTINCT FROM OLD."invoiceNumber"
    OR NEW."subtotal"         IS DISTINCT FROM OLD."subtotal"
    OR NEW."taxTotal"         IS DISTINCT FROM OLD."taxTotal"
    OR NEW."total"            IS DISTINCT FROM OLD."total"
    OR NEW."currency"         IS DISTINCT FROM OLD."currency"
    OR NEW."billingPartyType" IS DISTINCT FROM OLD."billingPartyType"
    OR NEW."billingPartyName" IS DISTINCT FROM OLD."billingPartyName"
    OR NEW."financierId"      IS DISTINCT FROM OLD."financierId"
    OR NEW."bidderId"         IS DISTINCT FROM OLD."bidderId"
    OR NEW."seriesId"         IS DISTINCT FROM OLD."seriesId"
    OR NEW."issueDate"        IS DISTINCT FROM OLD."issueDate"
    OR NEW."type"             IS DISTINCT FROM OLD."type"
    THEN
      RAISE EXCEPTION
        'Invoice % is issued and its financial content is immutable (attempted change to amount, party or number)',
        OLD."invoiceNumber"
        USING ERRCODE = 'P0001',
              HINT = 'Void the invoice and raise a credit note.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_invoices_immutable_once_issued"
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION smartpark_invoices_immutability_guard();

-- Lines of an issued invoice cannot be altered or removed either.
CREATE OR REPLACE FUNCTION smartpark_invoice_lines_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
  parent_id UUID;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END;
  SELECT "status"::TEXT INTO parent_status FROM "invoices" WHERE "id" = parent_id;

  IF parent_status IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID') THEN
    RAISE EXCEPTION
      'Invoice lines cannot be % once the invoice is issued', lower(TG_OP)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "trg_invoice_lines_frozen_when_issued"
  BEFORE UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION smartpark_invoice_lines_guard();

-- --- Charge calculations --------------------------------------------------
-- A FINAL calculation backs an issued invoice, so its numbers are frozen. The
-- `isCurrent` flag is the sole exception, since a later calculation supersedes
-- it and must be able to clear the flag.
CREATE OR REPLACE FUNCTION smartpark_charge_calculations_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."type" = 'FINAL' THEN
      RAISE EXCEPTION 'A FINAL charge calculation cannot be deleted'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."type" = 'FINAL' THEN
    IF NEW."subtotal"        IS DISTINCT FROM OLD."subtotal"
    OR NEW."taxTotal"        IS DISTINCT FROM OLD."taxTotal"
    OR NEW."total"           IS DISTINCT FROM OLD."total"
    OR NEW."chargeableUnits" IS DISTINCT FROM OLD."chargeableUnits"
    OR NEW."inputsHash"      IS DISTINCT FROM OLD."inputsHash"
    OR NEW."ratePlanSnapshot" IS DISTINCT FROM OLD."ratePlanSnapshot"
    THEN
      RAISE EXCEPTION
        'FINAL charge calculation % is immutable; recalculate into a new row', OLD."id"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_charge_calculations_final_immutable"
  BEFORE UPDATE OR DELETE ON "charge_calculations"
  FOR EACH ROW EXECUTE FUNCTION smartpark_charge_calculations_guard();

-- --- Settlements ----------------------------------------------------------
CREATE OR REPLACE FUNCTION smartpark_settlements_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Auction settlements cannot be deleted' USING ERRCODE = 'P0001';
  END IF;

  IF NEW."winningBidId" IS DISTINCT FROM OLD."winningBidId"
  OR NEW."bidderId"     IS DISTINCT FROM OLD."bidderId"
  OR NEW."lotId"        IS DISTINCT FROM OLD."lotId"
  OR NEW."saleAmount"   IS DISTINCT FROM OLD."saleAmount"
  THEN
    RAISE EXCEPTION
      'Settlement % is bound to its winning bid and sale amount; these cannot change', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_settlements_bound_to_winning_bid"
  BEFORE UPDATE OR DELETE ON "auction_settlements"
  FOR EACH ROW EXECUTE FUNCTION smartpark_settlements_guard();

-- ===========================================================================
-- 6. TABLE COMMENTS (documentation that ships with the database)
-- ===========================================================================
COMMENT ON TABLE "vehicles" IS
  'Central vehicle repository. One row per registration number per organisation; every ANPR capture at every site resolves here. Basis of the financier intelligence service.';
COMMENT ON TABLE "parking_sessions" IS
  'One stay. Serves both repossession-yard and public-parking modes. At most one non-terminal session per vehicle (enforced by partial unique index).';
COMMENT ON TABLE "charge_calculations" IS
  'Reproducible charge workings. Given the same inputsHash the engine must produce identical output; the rate plan is snapshotted so re-pricing a past stay is impossible.';
COMMENT ON TABLE "bids" IS
  'Immutable auction bids. Amount, bidder, time and sequence are protected by trigger; only status may advance.';
COMMENT ON TABLE "audit_logs" IS
  'Append-only audit trail. UPDATE and DELETE are rejected by trigger.';
COMMENT ON TABLE "outbox_events" IS
  'Transactional outbox. Events are written in the same transaction as the state change and relayed asynchronously.';
COMMENT ON TABLE "idempotency_records" IS
  'Server-side idempotency for unsafe HTTP methods. Inserted IN_PROGRESS before the handler runs so concurrent retries collide instead of double-executing.';
COMMENT ON TABLE "system_settings" IS
  'Business configuration. Operational behaviour changes here, never in code.';
