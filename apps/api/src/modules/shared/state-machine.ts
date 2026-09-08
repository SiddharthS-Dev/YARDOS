import {
  AUCTION_LOT_TRANSITIONS,
  AUCTION_TRANSITIONS,
  AuctionLotStatus,
  AuctionStatus,
  BID_TRANSITIONS,
  BidStatus,
  CONTRACT_VERSION_TRANSITIONS,
  ContractVersionStatus,
  ErrorCode,
  INVOICE_TRANSITIONS,
  InvoiceStatus,
  PARKING_SESSION_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  ParkingSessionStatus,
  PaymentStatus,
  RELEASE_TRANSITIONS,
  ReleaseRequestStatus,
  SETTLEMENT_TRANSITIONS,
  SettlementStatus,
  TransitionTable,
  VEHICLE_TRANSITIONS,
  VehicleStatus,
  allowedTransitions,
  canTransition,
} from '@smartpark/contracts';

import { invalidTransition } from '@/common/errors/app-exception';

/**
 * Server-side enforcement of every lifecycle.
 *
 * Requirement S8: "Do not allow arbitrary status updates from the UI. State
 * transitions must be validated by backend business rules."
 *
 * Every status change in the platform goes through one of these guards. A
 * service that writes a status column directly is a bug, and the pattern is
 * uniform enough that such a write is easy to spot in review.
 *
 * The transition tables themselves live in `@smartpark/contracts` so the
 * console can grey out impossible actions using exactly the same data the
 * server enforces - the UI can never offer a button the server would reject,
 * and can never be the authority either.
 */
export class StateMachine<T extends string> {
  constructor(
    private readonly table: TransitionTable<T>,
    private readonly entityLabel: string,
    private readonly errorCode: string,
  ) {}

  /**
   * Asserts that `from -> to` is legal.
   *
   * A no-op transition (`from === to`) is rejected rather than ignored: it
   * almost always means the caller read a stale value, and silently accepting
   * it would hide the bug.
   *
   * @throws AppException with this machine's specific transition error code.
   */
  assert(from: T, to: T): void {
    if (!canTransition(this.table, from, to)) {
      throw invalidTransition(
        this.errorCode,
        this.entityLabel,
        from,
        to,
        allowedTransitions(this.table, from),
      );
    }
  }

  can(from: T, to: T): boolean {
    return canTransition(this.table, from, to);
  }

  next(from: T): readonly T[] {
    return allowedTransitions(this.table, from);
  }

  isTerminal(state: T): boolean {
    return allowedTransitions(this.table, state).length === 0;
  }

  /**
   * Walks a path of transitions, asserting each hop.
   *
   * Used where a single business action legitimately advances an aggregate
   * more than one step - for example a cash exit taking a vehicle straight
   * from PARKED to EXITED via the intermediate release states.
   */
  assertPath(from: T, path: readonly T[]): void {
    let current = from;
    for (const step of path) {
      this.assert(current, step);
      current = step;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The concrete machines                                               */
/* ------------------------------------------------------------------ */

export const VehicleStateMachine = new StateMachine<VehicleStatus>(
  VEHICLE_TRANSITIONS,
  'Vehicle',
  ErrorCode.INVALID_VEHICLE_STATE_TRANSITION,
);

export const ParkingSessionStateMachine = new StateMachine<ParkingSessionStatus>(
  PARKING_SESSION_TRANSITIONS,
  'Parking session',
  ErrorCode.INVALID_SESSION_STATE_TRANSITION,
);

export const InvoiceStateMachine = new StateMachine<InvoiceStatus>(
  INVOICE_TRANSITIONS,
  'Invoice',
  ErrorCode.INVALID_INVOICE_STATE_TRANSITION,
);

export const PaymentStateMachine = new StateMachine<PaymentStatus>(
  PAYMENT_TRANSITIONS,
  'Payment',
  ErrorCode.INVALID_PAYMENT_STATE_TRANSITION,
);

export const ReleaseStateMachine = new StateMachine<ReleaseRequestStatus>(
  RELEASE_TRANSITIONS,
  'Release request',
  ErrorCode.INVALID_RELEASE_STATE_TRANSITION,
);

export const AuctionStateMachine = new StateMachine<AuctionStatus>(
  AUCTION_TRANSITIONS,
  'Auction',
  ErrorCode.INVALID_AUCTION_STATE_TRANSITION,
);

export const AuctionLotStateMachine = new StateMachine<AuctionLotStatus>(
  AUCTION_LOT_TRANSITIONS,
  'Auction lot',
  ErrorCode.INVALID_LOT_STATE_TRANSITION,
);

export const BidStateMachine = new StateMachine<BidStatus>(
  BID_TRANSITIONS,
  'Bid',
  ErrorCode.BID_IMMUTABLE,
);

export const SettlementStateMachine = new StateMachine<SettlementStatus>(
  SETTLEMENT_TRANSITIONS,
  'Settlement',
  ErrorCode.CONFLICT,
);

export const ContractVersionStateMachine = new StateMachine<ContractVersionStatus>(
  CONTRACT_VERSION_TRANSITIONS,
  'Contract version',
  ErrorCode.CONTRACT_VERSION_NOT_EDITABLE,
);
