-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('REPOSSESSION_YARD', 'AIRPORT_PARKING', 'METRO_PARKING', 'RAILWAY_PARKING', 'OTHER_PUBLIC_PARKING');

-- CreateEnum
CREATE TYPE "ParkingMode" AS ENUM ('REPOSSESSION_YARD', 'PUBLIC_PARKING');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('PLANNED', 'ACTIVE', 'SUSPENDED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "TravelDirection" AS ENUM ('ENTRY', 'EXIT', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "GateStatus" AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ParkingSpaceStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'BLOCKED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "VehicleClass" AS ENUM ('TWO_WHEELER', 'THREE_WHEELER', 'CAR', 'SUV', 'LCV', 'HCV', 'BUS', 'TRACTOR', 'CONSTRUCTION_EQUIPMENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('CAPTURED', 'IDENTIFIED', 'VAHAN_PENDING', 'VAHAN_VERIFIED', 'VAHAN_FAILED', 'FINANCIER_MATCHED', 'YARD_ADMITTED', 'PARKED', 'UNDER_HOLD', 'RELEASE_REQUESTED', 'RELEASE_APPROVED', 'AUCTION_ELIGIBLE', 'AUCTION_LISTED', 'BIDDING_OPEN', 'BIDDING_CLOSED', 'WINNER_SELECTED', 'SETTLEMENT_PENDING', 'SETTLED', 'SOLD', 'EXITED');

-- CreateEnum
CREATE TYPE "VahanVerificationStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'VERIFIED', 'FAILED', 'UNAVAILABLE', 'MANUALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "HypothecationStatus" AS ENUM ('HYPOTHECATED', 'NOT_HYPOTHECATED', 'TERMINATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FinancierMatchMethod" AS ENUM ('VAHAN_HYPOTHECATION', 'VAHAN_ALIAS', 'MANUAL', 'FINANCIER_DECLARED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "AnprEventStatus" AS ENUM ('RECEIVED', 'DUPLICATE', 'PENDING_REVIEW', 'PROCESSED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE', 'MAINTENANCE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('ANPR', 'VEHICLE_REGISTRY', 'PAYMENT', 'SMS', 'EMAIL', 'WHATSAPP', 'OBJECT_STORAGE');

-- CreateEnum
CREATE TYPE "IntegrationCallStatus" AS ENUM ('SUCCESS', 'FAILURE', 'TIMEOUT', 'CIRCUIT_OPEN', 'RATE_LIMITED', 'SKIPPED_CACHED');

-- CreateEnum
CREATE TYPE "LookupStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'EXHAUSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingUnit" AS ENUM ('MINUTE', 'HOUR', 'DAY', 'CALENDAR_DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('CEIL', 'FLOOR', 'NEAREST');

-- CreateEnum
CREATE TYPE "FreeUnitPolicy" AS ENUM ('CONSUME_LADDER', 'SKIP_LADDER');

-- CreateEnum
CREATE TYPE "RatePlanScope" AS ENUM ('CONTRACT', 'SITE_TARIFF');

-- CreateEnum
CREATE TYPE "RateSlabKind" AS ENUM ('PER_UNIT', 'FLAT');

-- CreateEnum
CREATE TYPE "RatePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ParkingSessionStatus" AS ENUM ('OPEN', 'ON_HOLD', 'PENDING_EXIT', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdmissionMethod" AS ENUM ('ANPR_AUTO', 'ANPR_REVIEWED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChargeCalculationType" AS ENUM ('ESTIMATE', 'ACCRUAL', 'FINAL');

-- CreateEnum
CREATE TYPE "ChargeLineKind" AS ENUM ('SLAB', 'FREE_ALLOWANCE', 'GRACE', 'MINIMUM_CHARGE', 'DAILY_CAP_ADJUSTMENT', 'TAX');

-- CreateEnum
CREATE TYPE "BillingPartyType" AS ENUM ('FINANCIER', 'CUSTOMER', 'BIDDER', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingRuleScope" AS ENUM ('GLOBAL', 'SITE', 'FINANCIER', 'CONTRACT_VERSION');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('PARKING', 'SALE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'GENERATED', 'VALIDATED', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'NET_BANKING', 'BANK_TRANSFER', 'CHEQUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TaxComponentKind" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "TaxBase" AS ENUM ('SUBTOTAL', 'RUNNING_TOTAL');

-- CreateEnum
CREATE TYPE "ReleaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ELIGIBILITY_FAILED', 'AWAITING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'OPEN', 'CLOSED', 'WINNER_SELECTED', 'SETTLEMENT_PENDING', 'SETTLED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuctionLotStatus" AS ENUM ('DRAFT', 'LISTED', 'BIDDING_OPEN', 'BIDDING_CLOSED', 'WINNER_SELECTED', 'UNSOLD', 'SETTLEMENT_PENDING', 'SETTLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BidderStatus" AS ENUM ('REGISTERED', 'KYC_PENDING', 'APPROVED', 'SUSPENDED', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "AuctionRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('ACCEPTED', 'OUTBID', 'WINNING', 'WON', 'LOST', 'RETRACTED');

-- CreateEnum
CREATE TYPE "BidChannel" AS ENUM ('PORTAL', 'HALL', 'PHONE', 'API');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ANPR_CAPTURE', 'VEHICLE_PHOTO', 'INVOICE_PDF', 'AUCTION_DOCUMENT', 'RELEASE_DOCUMENT', 'FINANCIER_DOCUMENT', 'BIDDER_KYC', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'DEVICE', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('GLOBAL', 'SITE');

-- CreateEnum
CREATE TYPE "SettingDataType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'DURATION_MINUTES');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('ANPR_CAPTURED', 'ANPR_REVIEW_REQUIRED', 'ANPR_MANUALLY_RESOLVED', 'VEHICLE_CREATED', 'VEHICLE_STATUS_CHANGED', 'VAHAN_LOOKUP_REQUESTED', 'VAHAN_LOOKUP_SUCCEEDED', 'VAHAN_LOOKUP_FAILED', 'OWNERSHIP_UPDATED', 'FINANCIER_MATCHED', 'CONTRACT_RESOLVED', 'SESSION_OPENED', 'SPACE_ALLOCATED', 'SPACE_CHANGED', 'HOLD_PLACED', 'HOLD_LIFTED', 'CHARGE_ACCRUED', 'RELEASE_REQUESTED', 'RELEASE_APPROVED', 'RELEASE_REJECTED', 'INVOICE_GENERATED', 'INVOICE_ISSUED', 'PAYMENT_RECEIVED', 'SESSION_CLOSED', 'VEHICLE_EXITED', 'AUCTION_LISTED', 'BIDDING_OPENED', 'BID_PLACED', 'BIDDING_CLOSED', 'AUCTION_WINNER_SELECTED', 'AUCTION_SETTLED', 'VEHICLE_SOLD');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "legalName" VARCHAR(256) NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "gstin" VARCHAR(20),
    "pan" VARCHAR(16),
    "addressLine1" VARCHAR(256),
    "addressLine2" VARCHAR(256),
    "city" VARCHAR(128),
    "state" VARCHAR(128),
    "postalCode" VARCHAR(16),
    "country" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "contactEmail" VARCHAR(256),
    "contactPhone" VARCHAR(32),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "defaultCurrency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "logoDocumentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "siteType" "SiteType" NOT NULL,
    "parkingMode" "ParkingMode" NOT NULL,
    "status" "SiteStatus" NOT NULL DEFAULT 'PLANNED',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "addressLine1" VARCHAR(256),
    "addressLine2" VARCHAR(256),
    "city" VARCHAR(128),
    "state" VARCHAR(128),
    "postalCode" VARCHAR(16),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "totalCapacity" INTEGER NOT NULL DEFAULT 0,
    "contactName" VARCHAR(128),
    "contactPhone" VARCHAR(32),
    "contactEmail" VARCHAR(256),
    "taxProfileId" UUID,
    "goLiveDate" DATE,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "direction" "TravelDirection" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "status" "GateStatus" NOT NULL DEFAULT 'ONLINE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lanes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gateId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "direction" "TravelDirection" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lanes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "allowedClasses" "VehicleClass"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parking_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_spaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "zoneId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "status" "ParkingSpaceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" VARCHAR(512),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parking_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "email" VARCHAR(256) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32),
    "passwordHash" VARCHAR(512) NOT NULL,
    "passwordAlgorithm" VARCHAR(32) NOT NULL DEFAULT 'scrypt',
    "passwordUpdatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "financierId" UUID,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" VARCHAR(512),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "lastLoginIp" VARCHAR(64),
    "isServiceAccount" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedById" UUID,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "user_site_access" (
    "userId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_site_access_pkey" PRIMARY KEY ("userId","siteId")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "familyId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" VARCHAR(128),
    "replacedByTokenId" UUID,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(256) NOT NULL,
    "userId" UUID,
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(64),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "legalName" VARCHAR(256) NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "gstin" VARCHAR(20),
    "pan" VARCHAR(16),
    "addressLine1" VARCHAR(256),
    "addressLine2" VARCHAR(256),
    "city" VARCHAR(128),
    "state" VARCHAR(128),
    "postalCode" VARCHAR(16),
    "billingEmail" VARCHAR(256),
    "billingPhone" VARCHAR(32),
    "notificationEmails" TEXT[],
    "notificationPhones" TEXT[],
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "financiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financier_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "financierId" UUID NOT NULL,
    "alias" VARCHAR(256) NOT NULL,
    "normalizedAlias" VARCHAR(256) NOT NULL,
    "source" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "financier_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financier_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "financierId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "designation" VARCHAR(128),
    "email" VARCHAR(256),
    "phone" VARCHAR(32),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "registrationNumber" VARCHAR(32) NOT NULL,
    "normalizedRegistrationNumber" VARCHAR(16) NOT NULL,
    "registrationFormat" VARCHAR(24) NOT NULL DEFAULT 'UNRECOGNISED',
    "vehicleClass" "VehicleClass" NOT NULL DEFAULT 'UNKNOWN',
    "vehicleType" VARCHAR(64),
    "make" VARCHAR(96),
    "model" VARCHAR(96),
    "variant" VARCHAR(96),
    "color" VARCHAR(48),
    "fuelType" "FuelType",
    "manufacturingYear" INTEGER,
    "chassisNumberLast4" VARCHAR(8),
    "engineNumberLast4" VARCHAR(8),
    "registeredOwnerName" VARCHAR(256),
    "registeredOwnerAddress" VARCHAR(512),
    "hypothecationStatus" "HypothecationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "vahanVerificationStatus" "VahanVerificationStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "vahanVerifiedAt" TIMESTAMPTZ(6),
    "currentFinancierId" UUID,
    "financierMatchMethod" "FinancierMatchMethod" NOT NULL DEFAULT 'UNMATCHED',
    "financierMatchConfidence" DECIMAL(5,4),
    "status" "VehicleStatus" NOT NULL DEFAULT 'CAPTURED',
    "currentSiteId" UUID,
    "currentSessionId" UUID,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_ownership_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "registeredOwnerName" VARCHAR(256),
    "registeredOwnerAddress" VARCHAR(512),
    "financierNameRaw" VARCHAR(256),
    "matchedFinancierId" UUID,
    "hypothecationStatus" "HypothecationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "vehicleClass" "VehicleClass",
    "vehicleType" VARCHAR(64),
    "make" VARCHAR(96),
    "model" VARCHAR(96),
    "variant" VARCHAR(96),
    "color" VARCHAR(48),
    "fuelType" "FuelType",
    "manufacturingYear" INTEGER,
    "registrationDate" DATE,
    "fitnessValidUpto" DATE,
    "insuranceValidUpto" DATE,
    "rawResponse" JSONB,
    "retrievedAt" TIMESTAMPTZ(6) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_ownership_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_financier_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID NOT NULL,
    "financierId" UUID,
    "financierNameRaw" VARCHAR(256),
    "matchMethod" "FinancierMatchMethod" NOT NULL,
    "confidence" DECIMAL(5,4),
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "sourceOwnershipRecordId" UUID,
    "reason" VARCHAR(512),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_financier_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_timeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "sessionId" UUID,
    "siteId" UUID,
    "type" "TimelineEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "actorId" UUID,
    "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorLabel" VARCHAR(160),
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "payload" JSONB,
    "correlationId" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anpr_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "gateId" UUID,
    "laneId" UUID,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerDeviceId" VARCHAR(128) NOT NULL,
    "direction" "TravelDirection" NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "sharedSecretHash" VARCHAR(128),
    "confidenceThreshold" DECIMAL(5,4),
    "lastHeartbeatAt" TIMESTAMPTZ(6),
    "lastEventAt" TIMESTAMPTZ(6),
    "firmwareVersion" VARCHAR(64),
    "ipAddress" VARCHAR(64),
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "anpr_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anpr_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "gateId" UUID,
    "laneId" UUID,
    "providerEventId" VARCHAR(128) NOT NULL,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plateNumberRaw" VARCHAR(32) NOT NULL,
    "normalizedPlate" VARCHAR(16) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "direction" "TravelDirection" NOT NULL,
    "vehicleClassHint" "VehicleClass",
    "status" "AnprEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "dedupeKey" VARCHAR(128) NOT NULL,
    "vehicleId" UUID,
    "parkingSessionId" UUID,
    "imageDocumentId" UUID,
    "plateImageDocumentId" UUID,
    "rawPayload" JSONB,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNotes" VARCHAR(512),
    "correctedPlate" VARCHAR(16),
    "processingError" VARCHAR(512),
    "processedAt" TIMESTAMPTZ(6),
    "correlationId" VARCHAR(64) NOT NULL,

    CONSTRAINT "anpr_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_registry_lookups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicleId" UUID,
    "normalizedRegistrationNumber" VARCHAR(16) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "status" "LookupStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "triggeredBy" VARCHAR(32) NOT NULL,
    "requestedById" UUID,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "errorCode" VARCHAR(64),
    "errorMessage" VARCHAR(512),
    "responseHash" VARCHAR(64),
    "ownershipRecordId" UUID,
    "nextRetryAt" TIMESTAMPTZ(6),
    "correlationId" VARCHAR(64) NOT NULL,

    CONSTRAINT "vehicle_registry_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "financierId" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" UUID,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contractId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "ContractVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "defaultBillingParty" "BillingPartyType" NOT NULL DEFAULT 'FINANCIER',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "taxProfileId" UUID,
    "notes" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "supersededAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "scope" "RatePlanScope" NOT NULL,
    "contractVersionId" UUID,
    "siteId" UUID,
    "vehicleClass" "VehicleClass",
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(512),
    "billingUnit" "BillingUnit" NOT NULL,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'CEIL',
    "freeUnits" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "freeUnitPolicy" "FreeUnitPolicy" NOT NULL DEFAULT 'CONSUME_LADDER',
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "minimumChargeAmount" DECIMAL(18,4),
    "dailyCapAmount" DECIMAL(18,4),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "status" "RatePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_slabs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ratePlanId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fromUnit" DECIMAL(14,6) NOT NULL,
    "toUnit" DECIMAL(14,6),
    "kind" "RateSlabKind" NOT NULL DEFAULT 'PER_UNIT',
    "amount" DECIMAL(18,4) NOT NULL,
    "description" VARCHAR(256),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taxProfileId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "kind" "TaxComponentKind" NOT NULL DEFAULT 'PERCENTAGE',
    "rate" DECIMAL(9,6) NOT NULL,
    "base" "TaxBase" NOT NULL DEFAULT 'SUBTOTAL',
    "hsnSac" VARCHAR(16),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(512),
    "scopeType" "BillingRuleScope" NOT NULL DEFAULT 'GLOBAL',
    "siteId" UUID,
    "financierId" UUID,
    "contractVersionId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL,
    "outcomePartyType" "BillingPartyType" NOT NULL,
    "outcomeNote" VARCHAR(512),
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "sessionNumber" VARCHAR(32) NOT NULL,
    "parkingMode" "ParkingMode" NOT NULL,
    "status" "ParkingSessionStatus" NOT NULL DEFAULT 'OPEN',
    "entryAt" TIMESTAMPTZ(6) NOT NULL,
    "exitAt" TIMESTAMPTZ(6),
    "entryGateId" UUID,
    "exitGateId" UUID,
    "entryLaneId" UUID,
    "exitLaneId" UUID,
    "entryAnprEventId" UUID,
    "exitAnprEventId" UUID,
    "financierId" UUID,
    "contractVersionId" UUID,
    "ratePlanId" UUID,
    "ratePlanSnapshot" JSONB,
    "rateUnresolved" BOOLEAN NOT NULL DEFAULT false,
    "zoneId" UUID,
    "spaceId" UUID,
    "admissionMethod" "AdmissionMethod" NOT NULL DEFAULT 'ANPR_AUTO',
    "admittedById" UUID,
    "holdReason" VARCHAR(512),
    "heldById" UUID,
    "heldAt" TIMESTAMPTZ(6),
    "closedById" UUID,
    "closureReason" VARCHAR(512),
    "correlationId" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "spaceId" UUID,
    "allocatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(6),
    "allocatedById" UUID,
    "reason" VARCHAR(256),

    CONSTRAINT "parking_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_calculations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" "ChargeCalculationType" NOT NULL,
    "asOf" TIMESTAMPTZ(6) NOT NULL,
    "engineVersion" VARCHAR(16) NOT NULL,
    "ratePlanId" UUID,
    "ratePlanSnapshot" JSONB NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "billingUnit" "BillingUnit" NOT NULL,
    "roundingMode" "RoundingMode" NOT NULL,
    "freeUnitPolicy" "FreeUnitPolicy" NOT NULL,
    "rawDurationMinutes" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalUnits" DECIMAL(14,6) NOT NULL,
    "freeUnits" DECIMAL(14,6) NOT NULL,
    "chargeableUnits" DECIMAL(14,6) NOT NULL,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "taxTotal" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "inputsHash" VARCHAR(64) NOT NULL,
    "explanation" JSONB NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "calculatedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "calculationId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "kind" "ChargeLineKind" NOT NULL,
    "description" VARCHAR(256) NOT NULL,
    "fromUnit" DECIMAL(14,6),
    "toUnit" DECIMAL(14,6),
    "units" DECIMAL(14,6) NOT NULL,
    "unitAmount" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "rateSlabId" UUID,

    CONSTRAINT "charge_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "siteId" UUID,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'PARKING',
    "prefix" VARCHAR(48) NOT NULL,
    "financialYear" VARCHAR(16),
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "seriesId" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'PARKING',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceNumber" VARCHAR(48) NOT NULL,
    "issueDate" DATE,
    "dueDate" DATE,
    "billingPartyType" "BillingPartyType" NOT NULL,
    "financierId" UUID,
    "bidderId" UUID,
    "billingPartyName" VARCHAR(256) NOT NULL,
    "billingPartyAddress" VARCHAR(512),
    "billingPartyGstin" VARCHAR(20),
    "billingPartyEmail" VARCHAR(256),
    "billingPartyPhone" VARCHAR(32),
    "billingRuleId" UUID,
    "sessionId" UUID,
    "vehicleId" UUID,
    "auctionLotId" UUID,
    "chargeCalculationId" UUID,
    "relatedInvoiceId" UUID,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "pdfDocumentId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "issuedById" UUID,
    "issuedAt" TIMESTAMPTZ(6),
    "sentAt" TIMESTAMPTZ(6),
    "voidedById" UUID,
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" VARCHAR(512),
    "correlationId" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoiceId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" VARCHAR(512) NOT NULL,
    "quantity" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "hsnSac" VARCHAR(16),
    "chargeLineId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_tax_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoiceId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "kind" "TaxComponentKind" NOT NULL,
    "rate" DECIMAL(9,6) NOT NULL,
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "invoice_tax_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "method" "PaymentMethod" NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerOrderId" VARCHAR(128),
    "providerTransactionId" VARCHAR(128),
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "initiatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "failureReason" VARCHAR(512),
    "reference" VARCHAR(128),
    "receivedById" UUID,
    "metadata" JSONB,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(64) NOT NULL,
    "providerEventId" VARCHAR(128) NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "paymentId" UUID,
    "processingError" VARCHAR(512),
    "correlationId" VARCHAR(64) NOT NULL,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "requestNumber" VARCHAR(32) NOT NULL,
    "status" "ReleaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedForPartyType" "BillingPartyType" NOT NULL,
    "requestedForName" VARCHAR(256),
    "requestedForPhone" VARCHAR(32),
    "requestedForIdRef" VARCHAR(128),
    "reason" VARCHAR(512) NOT NULL,
    "eligibilitySnapshot" JSONB,
    "eligibilityCheckedAt" TIMESTAMPTZ(6),
    "chargeCalculationId" UUID,
    "invoiceId" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "rejectedById" UUID,
    "rejectedAt" TIMESTAMPTZ(6),
    "rejectionReason" VARCHAR(512),
    "authorizationCodeHash" VARCHAR(128),
    "authorizationExpiresAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "completedById" UUID,
    "exitAnprEventId" UUID,
    "correlationId" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "release_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "releaseRequestId" UUID NOT NULL,
    "approverId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "remarks" VARCHAR(512),
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "correlationId" VARCHAR(64),

    CONSTRAINT "release_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "siteId" UUID,
    "code" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledStartAt" TIMESTAMPTZ(6) NOT NULL,
    "scheduledEndAt" TIMESTAMPTZ(6) NOT NULL,
    "actualStartAt" TIMESTAMPTZ(6),
    "actualEndAt" TIMESTAMPTZ(6),
    "defaultMinIncrement" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "termsAndConditions" TEXT,
    "registrationDeposit" DECIMAL(18,4),
    "publishedById" UUID,
    "publishedAt" TIMESTAMPTZ(6),
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(6),
    "cancelledReason" VARCHAR(512),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "lotNumber" INTEGER NOT NULL,
    "vehicleId" UUID NOT NULL,
    "sessionId" UUID,
    "status" "AuctionLotStatus" NOT NULL DEFAULT 'DRAFT',
    "reservePrice" DECIMAL(18,4) NOT NULL,
    "startingPrice" DECIMAL(18,4),
    "minIncrement" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "description" TEXT,
    "conditionNotes" TEXT,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "highestBidAmount" DECIMAL(18,4),
    "winningBidId" UUID,
    "winnerBidderId" UUID,
    "winnerSelectedById" UUID,
    "winnerSelectedAt" TIMESTAMPTZ(6),
    "withdrawnReason" VARCHAR(512),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auction_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "legalName" VARCHAR(256) NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "contactName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "email" VARCHAR(256),
    "addressLine1" VARCHAR(256),
    "city" VARCHAR(128),
    "state" VARCHAR(128),
    "postalCode" VARCHAR(16),
    "pan" VARCHAR(16),
    "gstin" VARCHAR(20),
    "status" "BidderStatus" NOT NULL DEFAULT 'REGISTERED',
    "kycVerifiedAt" TIMESTAMPTZ(6),
    "kycVerifiedById" UUID,
    "userId" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "blacklistReason" VARCHAR(512),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bidders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "status" "AuctionRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "depositPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "depositReference" VARCHAR(128),
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "rejectionReason" VARCHAR(512),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "auction_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lotId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "sequenceNo" INTEGER NOT NULL,
    "placedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BidStatus" NOT NULL DEFAULT 'ACCEPTED',
    "channel" "BidChannel" NOT NULL DEFAULT 'PORTAL',
    "placedById" UUID,
    "placedOnBehalf" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bidId" UUID NOT NULL,
    "fromStatus" "BidStatus",
    "toStatus" "BidStatus" NOT NULL,
    "reason" VARCHAR(256),
    "actorId" UUID,
    "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctionId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "winningBidId" UUID NOT NULL,
    "saleAmount" DECIMAL(18,4) NOT NULL,
    "feesAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalPayable" DECIMAL(18,4) NOT NULL,
    "amountReceived" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" DATE,
    "settledAt" TIMESTAMPTZ(6),
    "settledById" UUID,
    "saleInvoiceId" UUID,
    "defaultReason" VARCHAR(512),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auction_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" VARCHAR(8) NOT NULL DEFAULT 'en',
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(512),
    "subjectTemplate" VARCHAR(512),
    "bodyTemplate" TEXT NOT NULL,
    "variables" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "templateCode" VARCHAR(64) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientMasked" VARCHAR(256) NOT NULL,
    "recipientCipher" VARCHAR(1024) NOT NULL,
    "subject" VARCHAR(512),
    "bodyPreview" VARCHAR(512),
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" VARCHAR(64),
    "providerMessageId" VARCHAR(128),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" VARCHAR(512),
    "queuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "nextRetryAt" TIMESTAMPTZ(6),
    "entityType" VARCHAR(48),
    "entityId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "correlationId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "siteId" UUID,
    "kind" "DocumentKind" NOT NULL,
    "entityType" VARCHAR(48) NOT NULL,
    "entityId" UUID,
    "fileName" VARCHAR(256) NOT NULL,
    "contentType" VARCHAR(128) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "checksumSha256" VARCHAR(64) NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMPTZ(6),
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "retentionUntil" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorLabel" VARCHAR(256),
    "actorRoles" TEXT[],
    "action" VARCHAR(96) NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(64),
    "siteId" UUID,
    "beforeState" JSONB,
    "afterState" JSONB,
    "changedFields" TEXT[],
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "correlationId" VARCHAR(64) NOT NULL,
    "requestId" VARCHAR(64),
    "reason" VARCHAR(512),
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "errorCode" VARCHAR(64),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID,
    "kind" "IntegrationKind" NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(96) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "status" "IntegrationCallStatus" NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "requestSummary" JSONB,
    "responseSummary" JSONB,
    "errorCode" VARCHAR(64),
    "errorMessage" VARCHAR(512),
    "entityType" VARCHAR(48),
    "entityId" VARCHAR(64),
    "correlationId" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregateType" VARCHAR(64) NOT NULL,
    "aggregateId" VARCHAR(64) NOT NULL,
    "eventType" VARCHAR(96) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "publishedAt" TIMESTAMPTZ(6),
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(512),
    "correlationId" VARCHAR(64) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" VARCHAR(96) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "userId" UUID,
    "correlationId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "scope" "SettingScope" NOT NULL DEFAULT 'GLOBAL',
    "siteId" UUID,
    "siteScopeKey" VARCHAR(64) NOT NULL DEFAULT 'GLOBAL',
    "key" VARCHAR(128) NOT NULL,
    "valueJson" JSONB NOT NULL,
    "dataType" "SettingDataType" NOT NULL DEFAULT 'STRING',
    "description" VARCHAR(512) NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobName" VARCHAR(96) NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" VARCHAR(24) NOT NULL,
    "triggeredById" UUID,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "durationMs" INTEGER,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(1000),
    "metadata" JSONB,
    "correlationId" VARCHAR(64) NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "sites_organizationId_status_idx" ON "sites"("organizationId", "status");

-- CreateIndex
CREATE INDEX "sites_siteType_idx" ON "sites"("siteType");

-- CreateIndex
CREATE INDEX "sites_parkingMode_idx" ON "sites"("parkingMode");

-- CreateIndex
CREATE UNIQUE INDEX "sites_organizationId_code_key" ON "sites"("organizationId", "code");

-- CreateIndex
CREATE INDEX "gates_siteId_status_idx" ON "gates"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gates_siteId_code_key" ON "gates"("siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lanes_gateId_code_key" ON "lanes"("gateId", "code");

-- CreateIndex
CREATE INDEX "parking_zones_siteId_isActive_idx" ON "parking_zones"("siteId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "parking_zones_siteId_code_key" ON "parking_zones"("siteId", "code");

-- CreateIndex
CREATE INDEX "parking_spaces_zoneId_status_idx" ON "parking_spaces"("zoneId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parking_spaces_zoneId_code_key" ON "parking_spaces"("zoneId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_status_idx" ON "users"("organizationId", "status");

-- CreateIndex
CREATE INDEX "users_financierId_idx" ON "users"("financierId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_code_key" ON "roles"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempts_email_attemptedAt_idx" ON "login_attempts"("email", "attemptedAt");

-- CreateIndex
CREATE INDEX "login_attempts_userId_attemptedAt_idx" ON "login_attempts"("userId", "attemptedAt");

-- CreateIndex
CREATE INDEX "financiers_organizationId_isActive_idx" ON "financiers"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "financiers_organizationId_code_key" ON "financiers"("organizationId", "code");

-- CreateIndex
CREATE INDEX "financier_aliases_normalizedAlias_idx" ON "financier_aliases"("normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "financier_aliases_financierId_normalizedAlias_key" ON "financier_aliases"("financierId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "financier_contacts_financierId_isActive_idx" ON "financier_contacts"("financierId", "isActive");

-- CreateIndex
CREATE INDEX "vehicles_organizationId_status_idx" ON "vehicles"("organizationId", "status");

-- CreateIndex
CREATE INDEX "vehicles_currentFinancierId_status_idx" ON "vehicles"("currentFinancierId", "status");

-- CreateIndex
CREATE INDEX "vehicles_currentSiteId_status_idx" ON "vehicles"("currentSiteId", "status");

-- CreateIndex
CREATE INDEX "vehicles_normalizedRegistrationNumber_idx" ON "vehicles"("normalizedRegistrationNumber");

-- CreateIndex
CREATE INDEX "vehicles_lastSeenAt_idx" ON "vehicles"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organizationId_normalizedRegistrationNumber_key" ON "vehicles"("organizationId", "normalizedRegistrationNumber");

-- CreateIndex
CREATE INDEX "vehicle_ownership_records_vehicleId_isCurrent_idx" ON "vehicle_ownership_records"("vehicleId", "isCurrent");

-- CreateIndex
CREATE INDEX "vehicle_ownership_records_vehicleId_retrievedAt_idx" ON "vehicle_ownership_records"("vehicleId", "retrievedAt");

-- CreateIndex
CREATE INDEX "vehicle_ownership_records_matchedFinancierId_idx" ON "vehicle_ownership_records"("matchedFinancierId");

-- CreateIndex
CREATE INDEX "vehicle_financier_history_vehicleId_effectiveFrom_idx" ON "vehicle_financier_history"("vehicleId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "vehicle_financier_history_financierId_effectiveFrom_idx" ON "vehicle_financier_history"("financierId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "vehicle_timeline_events_vehicleId_occurredAt_idx" ON "vehicle_timeline_events"("vehicleId", "occurredAt");

-- CreateIndex
CREATE INDEX "vehicle_timeline_events_sessionId_occurredAt_idx" ON "vehicle_timeline_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "vehicle_timeline_events_organizationId_type_occurredAt_idx" ON "vehicle_timeline_events"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "anpr_devices_siteId_status_idx" ON "anpr_devices"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "anpr_devices_siteId_code_key" ON "anpr_devices"("siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "anpr_devices_provider_providerDeviceId_key" ON "anpr_devices"("provider", "providerDeviceId");

-- CreateIndex
CREATE INDEX "anpr_events_siteId_capturedAt_idx" ON "anpr_events"("siteId", "capturedAt");

-- CreateIndex
CREATE INDEX "anpr_events_status_receivedAt_idx" ON "anpr_events"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "anpr_events_normalizedPlate_capturedAt_idx" ON "anpr_events"("normalizedPlate", "capturedAt");

-- CreateIndex
CREATE INDEX "anpr_events_organizationId_capturedAt_idx" ON "anpr_events"("organizationId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "anpr_events_deviceId_providerEventId_key" ON "anpr_events"("deviceId", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "anpr_events_dedupeKey_key" ON "anpr_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "vehicle_registry_lookups_status_nextRetryAt_idx" ON "vehicle_registry_lookups"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "vehicle_registry_lookups_normalizedRegistrationNumber_reque_idx" ON "vehicle_registry_lookups"("normalizedRegistrationNumber", "requestedAt");

-- CreateIndex
CREATE INDEX "vehicle_registry_lookups_vehicleId_requestedAt_idx" ON "vehicle_registry_lookups"("vehicleId", "requestedAt");

-- CreateIndex
CREATE INDEX "vehicle_registry_lookups_provider_requestedAt_idx" ON "vehicle_registry_lookups"("provider", "requestedAt");

-- CreateIndex
CREATE INDEX "contracts_financierId_status_idx" ON "contracts"("financierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_organizationId_code_key" ON "contracts"("organizationId", "code");

-- CreateIndex
CREATE INDEX "contract_versions_status_effectiveFrom_effectiveTo_idx" ON "contract_versions"("status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "contract_versions_contractId_versionNo_key" ON "contract_versions"("contractId", "versionNo");

-- CreateIndex
CREATE INDEX "rate_plans_contractVersionId_status_idx" ON "rate_plans"("contractVersionId", "status");

-- CreateIndex
CREATE INDEX "rate_plans_siteId_status_effectiveFrom_idx" ON "rate_plans"("siteId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "rate_plans_status_effectiveFrom_effectiveTo_idx" ON "rate_plans"("status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "rate_plans_organizationId_code_key" ON "rate_plans"("organizationId", "code");

-- CreateIndex
CREATE INDEX "rate_slabs_ratePlanId_fromUnit_idx" ON "rate_slabs"("ratePlanId", "fromUnit");

-- CreateIndex
CREATE UNIQUE INDEX "rate_slabs_ratePlanId_sequence_key" ON "rate_slabs"("ratePlanId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_organizationId_code_key" ON "tax_profiles"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_components_taxProfileId_sequence_key" ON "tax_components"("taxProfileId", "sequence");

-- CreateIndex
CREATE INDEX "billing_rules_organizationId_isActive_priority_idx" ON "billing_rules"("organizationId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "billing_rules_organizationId_code_key" ON "billing_rules"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "parking_sessions_sessionNumber_key" ON "parking_sessions"("sessionNumber");

-- CreateIndex
CREATE INDEX "parking_sessions_siteId_status_entryAt_idx" ON "parking_sessions"("siteId", "status", "entryAt");

-- CreateIndex
CREATE INDEX "parking_sessions_vehicleId_status_idx" ON "parking_sessions"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "parking_sessions_financierId_status_idx" ON "parking_sessions"("financierId", "status");

-- CreateIndex
CREATE INDEX "parking_sessions_organizationId_status_entryAt_idx" ON "parking_sessions"("organizationId", "status", "entryAt");

-- CreateIndex
CREATE INDEX "parking_sessions_entryAt_idx" ON "parking_sessions"("entryAt");

-- CreateIndex
CREATE INDEX "parking_sessions_exitAt_idx" ON "parking_sessions"("exitAt");

-- CreateIndex
CREATE INDEX "parking_allocations_sessionId_allocatedAt_idx" ON "parking_allocations"("sessionId", "allocatedAt");

-- CreateIndex
CREATE INDEX "parking_allocations_zoneId_releasedAt_idx" ON "parking_allocations"("zoneId", "releasedAt");

-- CreateIndex
CREATE INDEX "charge_calculations_sessionId_type_asOf_idx" ON "charge_calculations"("sessionId", "type", "asOf");

-- CreateIndex
CREATE INDEX "charge_calculations_sessionId_isCurrent_idx" ON "charge_calculations"("sessionId", "isCurrent");

-- CreateIndex
CREATE INDEX "charge_calculations_organizationId_createdAt_idx" ON "charge_calculations"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "charge_lines_calculationId_lineNo_key" ON "charge_lines"("calculationId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_organizationId_code_key" ON "invoice_series"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_idempotencyKey_key" ON "invoices"("idempotencyKey");

-- CreateIndex
CREATE INDEX "invoices_organizationId_status_issueDate_idx" ON "invoices"("organizationId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_financierId_status_idx" ON "invoices"("financierId", "status");

-- CreateIndex
CREATE INDEX "invoices_siteId_status_idx" ON "invoices"("siteId", "status");

-- CreateIndex
CREATE INDEX "invoices_sessionId_idx" ON "invoices"("sessionId");

-- CreateIndex
CREATE INDEX "invoices_vehicleId_idx" ON "invoices"("vehicleId");

-- CreateIndex
CREATE INDEX "invoices_status_dueDate_idx" ON "invoices"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoiceId_lineNo_key" ON "invoice_lines"("invoiceId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tax_lines_invoiceId_sequence_key" ON "invoice_tax_lines"("invoiceId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_invoiceId_status_idx" ON "payments"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "payments_organizationId_status_completedAt_idx" ON "payments"("organizationId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "payments_provider_providerTransactionId_idx" ON "payments"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processedAt_idx" ON "payment_webhook_events"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_providerEventId_key" ON "payment_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "release_requests_requestNumber_key" ON "release_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "release_requests_siteId_status_requestedAt_idx" ON "release_requests"("siteId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "release_requests_sessionId_idx" ON "release_requests"("sessionId");

-- CreateIndex
CREATE INDEX "release_requests_vehicleId_status_idx" ON "release_requests"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "release_requests_organizationId_status_idx" ON "release_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "release_approvals_releaseRequestId_decidedAt_idx" ON "release_approvals"("releaseRequestId", "decidedAt");

-- CreateIndex
CREATE INDEX "release_approvals_approverId_decidedAt_idx" ON "release_approvals"("approverId", "decidedAt");

-- CreateIndex
CREATE INDEX "auctions_organizationId_status_scheduledStartAt_idx" ON "auctions"("organizationId", "status", "scheduledStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_organizationId_code_key" ON "auctions"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "auction_lots_winningBidId_key" ON "auction_lots"("winningBidId");

-- CreateIndex
CREATE INDEX "auction_lots_auctionId_status_idx" ON "auction_lots"("auctionId", "status");

-- CreateIndex
CREATE INDEX "auction_lots_vehicleId_idx" ON "auction_lots"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_lots_auctionId_lotNumber_key" ON "auction_lots"("auctionId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "auction_lots_auctionId_vehicleId_key" ON "auction_lots"("auctionId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "bidders_userId_key" ON "bidders"("userId");

-- CreateIndex
CREATE INDEX "bidders_organizationId_status_idx" ON "bidders"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bidders_organizationId_code_key" ON "bidders"("organizationId", "code");

-- CreateIndex
CREATE INDEX "auction_registrations_auctionId_status_idx" ON "auction_registrations"("auctionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auction_registrations_auctionId_bidderId_key" ON "auction_registrations"("auctionId", "bidderId");

-- CreateIndex
CREATE UNIQUE INDEX "bids_idempotencyKey_key" ON "bids"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bids_lotId_amount_idx" ON "bids"("lotId", "amount");

-- CreateIndex
CREATE INDEX "bids_lotId_placedAt_idx" ON "bids"("lotId", "placedAt");

-- CreateIndex
CREATE INDEX "bids_bidderId_placedAt_idx" ON "bids"("bidderId", "placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bids_lotId_sequenceNo_key" ON "bids"("lotId", "sequenceNo");

-- CreateIndex
CREATE INDEX "bid_events_bidId_occurredAt_idx" ON "bid_events"("bidId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "auction_settlements_lotId_key" ON "auction_settlements"("lotId");

-- CreateIndex
CREATE INDEX "auction_settlements_auctionId_status_idx" ON "auction_settlements"("auctionId", "status");

-- CreateIndex
CREATE INDEX "auction_settlements_bidderId_status_idx" ON "auction_settlements"("bidderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_organizationId_code_channel_locale_key" ON "notification_templates"("organizationId", "code", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotencyKey_key" ON "notifications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notifications_status_nextRetryAt_idx" ON "notifications"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_channel_status_idx" ON "notifications"("organizationId", "channel", "status");

-- CreateIndex
CREATE INDEX "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_objectKey_key" ON "documents"("objectKey");

-- CreateIndex
CREATE INDEX "documents_entityType_entityId_idx" ON "documents"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "documents_organizationId_kind_uploadedAt_idx" ON "documents"("organizationId", "kind", "uploadedAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_occurredAt_idx" ON "audit_logs"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_occurredAt_idx" ON "audit_logs"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_occurredAt_idx" ON "audit_logs"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurredAt_idx" ON "audit_logs"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_correlationId_idx" ON "audit_logs"("correlationId");

-- CreateIndex
CREATE INDEX "integration_logs_kind_provider_occurredAt_idx" ON "integration_logs"("kind", "provider", "occurredAt");

-- CreateIndex
CREATE INDEX "integration_logs_status_occurredAt_idx" ON "integration_logs"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "integration_logs_correlationId_idx" ON "integration_logs"("correlationId");

-- CreateIndex
CREATE INDEX "outbox_events_status_nextAttemptAt_idx" ON "outbox_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregateType_aggregateId_idx" ON "outbox_events"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "system_settings_organizationId_scope_idx" ON "system_settings"("organizationId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_organizationId_siteScopeKey_key_key" ON "system_settings"("organizationId", "siteScopeKey", "key");

-- CreateIndex
CREATE INDEX "job_runs_jobName_startedAt_idx" ON "job_runs"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "job_runs_status_startedAt_idx" ON "job_runs"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gates" ADD CONSTRAINT "gates_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_zones" ADD CONSTRAINT "parking_zones_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "parking_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_site_access" ADD CONSTRAINT "user_site_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_site_access" ADD CONSTRAINT "user_site_access_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financiers" ADD CONSTRAINT "financiers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financier_aliases" ADD CONSTRAINT "financier_aliases_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financier_contacts" ADD CONSTRAINT "financier_contacts_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_currentFinancierId_fkey" FOREIGN KEY ("currentFinancierId") REFERENCES "financiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_currentSiteId_fkey" FOREIGN KEY ("currentSiteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownership_records" ADD CONSTRAINT "vehicle_ownership_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownership_records" ADD CONSTRAINT "vehicle_ownership_records_matchedFinancierId_fkey" FOREIGN KEY ("matchedFinancierId") REFERENCES "financiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financier_history" ADD CONSTRAINT "vehicle_financier_history_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financier_history" ADD CONSTRAINT "vehicle_financier_history_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financier_history" ADD CONSTRAINT "vehicle_financier_history_sourceOwnershipRecordId_fkey" FOREIGN KEY ("sourceOwnershipRecordId") REFERENCES "vehicle_ownership_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_timeline_events" ADD CONSTRAINT "vehicle_timeline_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_timeline_events" ADD CONSTRAINT "vehicle_timeline_events_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_timeline_events" ADD CONSTRAINT "vehicle_timeline_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_timeline_events" ADD CONSTRAINT "vehicle_timeline_events_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_devices" ADD CONSTRAINT "anpr_devices_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_devices" ADD CONSTRAINT "anpr_devices_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_devices" ADD CONSTRAINT "anpr_devices_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "lanes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_events" ADD CONSTRAINT "anpr_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_events" ADD CONSTRAINT "anpr_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "anpr_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_events" ADD CONSTRAINT "anpr_events_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_events" ADD CONSTRAINT "anpr_events_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_events" ADD CONSTRAINT "anpr_events_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "lanes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anpr_events" ADD CONSTRAINT "anpr_events_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registry_lookups" ADD CONSTRAINT "vehicle_registry_lookups_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registry_lookups" ADD CONSTRAINT "vehicle_registry_lookups_ownershipRecordId_fkey" FOREIGN KEY ("ownershipRecordId") REFERENCES "vehicle_ownership_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_slabs" ADD CONSTRAINT "rate_slabs_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_components" ADD CONSTRAINT "tax_components_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rules" ADD CONSTRAINT "billing_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rules" ADD CONSTRAINT "billing_rules_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rules" ADD CONSTRAINT "billing_rules_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rules" ADD CONSTRAINT "billing_rules_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "contract_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "parking_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "parking_spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_entryGateId_fkey" FOREIGN KEY ("entryGateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_exitGateId_fkey" FOREIGN KEY ("exitGateId") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_entryLaneId_fkey" FOREIGN KEY ("entryLaneId") REFERENCES "lanes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_exitLaneId_fkey" FOREIGN KEY ("exitLaneId") REFERENCES "lanes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_entryAnprEventId_fkey" FOREIGN KEY ("entryAnprEventId") REFERENCES "anpr_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_exitAnprEventId_fkey" FOREIGN KEY ("exitAnprEventId") REFERENCES "anpr_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_allocations" ADD CONSTRAINT "parking_allocations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "parking_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_allocations" ADD CONSTRAINT "parking_allocations_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "parking_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_allocations" ADD CONSTRAINT "parking_allocations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "parking_spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_calculations" ADD CONSTRAINT "charge_calculations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_calculations" ADD CONSTRAINT "charge_calculations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "parking_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_calculations" ADD CONSTRAINT "charge_calculations_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "charge_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_rateSlabId_fkey" FOREIGN KEY ("rateSlabId") REFERENCES "rate_slabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "invoice_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_financierId_fkey" FOREIGN KEY ("financierId") REFERENCES "financiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "bidders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_auctionLotId_fkey" FOREIGN KEY ("auctionLotId") REFERENCES "auction_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_chargeCalculationId_fkey" FOREIGN KEY ("chargeCalculationId") REFERENCES "charge_calculations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billingRuleId_fkey" FOREIGN KEY ("billingRuleId") REFERENCES "billing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tax_lines" ADD CONSTRAINT "invoice_tax_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "parking_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requests" ADD CONSTRAINT "release_requests_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_approvals" ADD CONSTRAINT "release_approvals_releaseRequestId_fkey" FOREIGN KEY ("releaseRequestId") REFERENCES "release_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_winningBidId_fkey" FOREIGN KEY ("winningBidId") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_winnerBidderId_fkey" FOREIGN KEY ("winnerBidderId") REFERENCES "bidders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_registrations" ADD CONSTRAINT "auction_registrations_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_registrations" ADD CONSTRAINT "auction_registrations_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "bidders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "auction_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "bidders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_events" ADD CONSTRAINT "bid_events_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "bids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_settlements" ADD CONSTRAINT "auction_settlements_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_settlements" ADD CONSTRAINT "auction_settlements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "auction_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_settlements" ADD CONSTRAINT "auction_settlements_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "bidders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_settlements" ADD CONSTRAINT "auction_settlements_saleInvoiceId_fkey" FOREIGN KEY ("saleInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
