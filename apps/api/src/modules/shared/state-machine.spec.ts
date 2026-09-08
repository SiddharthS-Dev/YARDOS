import { AppException } from '@/common/errors/app-exception';
import {
  AuctionLotStateMachine,
  AuctionStateMachine,
  BidStateMachine,
  InvoiceStateMachine,
  ParkingSessionStateMachine,
  PaymentStateMachine,
  ReleaseStateMachine,
  VehicleStateMachine,
} from './state-machine';

/**
 * Lifecycle specification.
 *
 * These are the rules that stop a vehicle being released twice, an invoice
 * being un-issued, or an auction acquiring a second winner. Each machine gets
 * both a "happy path is reachable" test and, more importantly, tests for the
 * transitions that must NOT be reachable.
 */
describe('state machines', () => {
  describe('VehicleStateMachine', () => {
    it('allows the standard yard intake path', () => {
      expect(() => {
        VehicleStateMachine.assertPath('CAPTURED', [
          'IDENTIFIED',
          'VAHAN_PENDING',
          'VAHAN_VERIFIED',
          'FINANCIER_MATCHED',
          'YARD_ADMITTED',
          'PARKED',
        ]);
      }).not.toThrow();
    });

    it('allows admission without waiting for registry enrichment', () => {
      // Requirement S9: the gate must never block on an external system.
      expect(VehicleStateMachine.can('VAHAN_PENDING', 'YARD_ADMITTED')).toBe(true);
    });

    it('allows the release path', () => {
      expect(() => {
        VehicleStateMachine.assertPath('PARKED', [
          'RELEASE_REQUESTED',
          'RELEASE_APPROVED',
          'EXITED',
        ]);
      }).not.toThrow();
    });

    it('allows the full auction path', () => {
      expect(() => {
        VehicleStateMachine.assertPath('PARKED', [
          'AUCTION_ELIGIBLE',
          'AUCTION_LISTED',
          'BIDDING_OPEN',
          'BIDDING_CLOSED',
          'WINNER_SELECTED',
          'SETTLEMENT_PENDING',
          'SETTLED',
          'SOLD',
          'EXITED',
        ]);
      }).not.toThrow();
    });

    it('returns a rejected release to the yard', () => {
      expect(VehicleStateMachine.can('RELEASE_REQUESTED', 'PARKED')).toBe(true);
    });

    it('returns an unsold vehicle to the yard', () => {
      expect(VehicleStateMachine.can('BIDDING_CLOSED', 'PARKED')).toBe(true);
    });

    it('refuses to skip straight from capture to parked', () => {
      expect(() => VehicleStateMachine.assert('CAPTURED', 'PARKED')).toThrow(AppException);
    });

    it('lets a returning vehicle start a new visit on the same record', () => {
      // EXITED ends a visit, not the vehicle. The central repository must
      // recognise the same vehicle on a later repossession or car-park entry.
      expect(VehicleStateMachine.can('EXITED', 'CAPTURED')).toBe(true);
    });

    it('refuses to put an exited vehicle straight back into the yard', () => {
      // A returning vehicle must walk the whole intake path again, so it is
      // re-identified and re-rated rather than inheriting a stale contract.
      expect(() => VehicleStateMachine.assert('EXITED', 'PARKED')).toThrow(AppException);
      expect(() => VehicleStateMachine.assert('EXITED', 'YARD_ADMITTED')).toThrow(AppException);
    });

    it('refuses to sell a vehicle that was never settled', () => {
      expect(() => VehicleStateMachine.assert('WINNER_SELECTED', 'SOLD')).toThrow(AppException);
    });

    it('refuses to auction a vehicle that is under hold without clearing it', () => {
      expect(VehicleStateMachine.can('UNDER_HOLD', 'RELEASE_REQUESTED')).toBe(false);
    });

    it('rejects a no-op transition rather than silently accepting it', () => {
      expect(() => VehicleStateMachine.assert('PARKED', 'PARKED')).toThrow(AppException);
    });

    it('reports the permitted next states on rejection', () => {
      try {
        VehicleStateMachine.assert('CAPTURED', 'SOLD');
        throw new Error('expected a rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        const details = (error as AppException).details as { allowedTransitions: string[] };
        expect(details.allowedTransitions).toContain('IDENTIFIED');
      }
    });
  });

  describe('ParkingSessionStateMachine', () => {
    it('allows open -> closed', () => {
      expect(ParkingSessionStateMachine.can('OPEN', 'CLOSED')).toBe(true);
    });

    it('allows a hold to be placed and lifted', () => {
      expect(ParkingSessionStateMachine.can('OPEN', 'ON_HOLD')).toBe(true);
      expect(ParkingSessionStateMachine.can('ON_HOLD', 'OPEN')).toBe(true);
    });

    it('refuses to reopen a closed stay', () => {
      expect(ParkingSessionStateMachine.isTerminal('CLOSED')).toBe(true);
      expect(() => ParkingSessionStateMachine.assert('CLOSED', 'OPEN')).toThrow(AppException);
    });

    it('refuses to cancel a stay that has already closed', () => {
      expect(ParkingSessionStateMachine.can('CLOSED', 'CANCELLED')).toBe(false);
    });
  });

  describe('InvoiceStateMachine', () => {
    it('allows the full issue-and-pay path', () => {
      expect(() => {
        InvoiceStateMachine.assertPath('DRAFT', [
          'GENERATED',
          'VALIDATED',
          'ISSUED',
          'SENT',
          'PARTIALLY_PAID',
          'PAID',
        ]);
      }).not.toThrow();
    });

    it('refuses to cancel an issued invoice (it must be voided)', () => {
      expect(InvoiceStateMachine.can('ISSUED', 'CANCELLED')).toBe(false);
      expect(InvoiceStateMachine.can('ISSUED', 'VOID')).toBe(true);
    });

    it('refuses to send an invoice back to draft', () => {
      expect(() => InvoiceStateMachine.assert('ISSUED', 'DRAFT')).toThrow(AppException);
    });

    it('refuses to un-void an invoice', () => {
      expect(InvoiceStateMachine.isTerminal('VOID')).toBe(true);
    });

    it('allows a paid invoice to be voided (with a credit note)', () => {
      expect(InvoiceStateMachine.can('PAID', 'VOID')).toBe(true);
    });
  });

  describe('PaymentStateMachine', () => {
    it('allows initiated -> pending -> success', () => {
      expect(() => PaymentStateMachine.assertPath('INITIATED', ['PENDING', 'SUCCESS'])).not.toThrow();
    });

    it('refuses to revive a failed payment', () => {
      expect(PaymentStateMachine.isTerminal('FAILED')).toBe(true);
      expect(() => PaymentStateMachine.assert('FAILED', 'SUCCESS')).toThrow(AppException);
    });

    it('allows only a refund after success', () => {
      expect(PaymentStateMachine.next('SUCCESS')).toEqual(['REFUNDED']);
    });
  });

  describe('ReleaseStateMachine', () => {
    it('allows the approval path', () => {
      expect(() => {
        ReleaseStateMachine.assertPath('DRAFT', [
          'SUBMITTED',
          'AWAITING_PAYMENT',
          'AWAITING_APPROVAL',
          'APPROVED',
          'COMPLETED',
        ]);
      }).not.toThrow();
    });

    it('refuses to complete a release that was never approved', () => {
      expect(() => ReleaseStateMachine.assert('AWAITING_APPROVAL', 'COMPLETED')).toThrow(
        AppException,
      );
    });

    it('refuses to reopen a completed release', () => {
      expect(ReleaseStateMachine.isTerminal('COMPLETED')).toBe(true);
    });

    it('refuses to reverse a rejection', () => {
      expect(ReleaseStateMachine.isTerminal('REJECTED')).toBe(true);
    });

    it('allows a failed eligibility check to be resubmitted', () => {
      expect(ReleaseStateMachine.can('ELIGIBILITY_FAILED', 'SUBMITTED')).toBe(true);
    });
  });

  describe('AuctionStateMachine', () => {
    it('allows the full auction path', () => {
      expect(() => {
        AuctionStateMachine.assertPath('DRAFT', [
          'SCHEDULED',
          'PUBLISHED',
          'OPEN',
          'CLOSED',
          'WINNER_SELECTED',
          'SETTLEMENT_PENDING',
          'SETTLED',
          'COMPLETED',
        ]);
      }).not.toThrow();
    });

    it('refuses to select a winner while bidding is open', () => {
      expect(() => AuctionStateMachine.assert('OPEN', 'WINNER_SELECTED')).toThrow(AppException);
    });

    it('refuses to cancel an auction that is already open', () => {
      expect(AuctionStateMachine.can('OPEN', 'CANCELLED')).toBe(false);
    });

    it('refuses to reopen a closed auction', () => {
      expect(AuctionStateMachine.can('CLOSED', 'OPEN')).toBe(false);
    });
  });

  describe('AuctionLotStateMachine', () => {
    it('lets an unsold lot be relisted', () => {
      expect(AuctionLotStateMachine.can('UNSOLD', 'LISTED')).toBe(true);
    });

    it('lets a defaulting settlement return the lot to unsold', () => {
      expect(AuctionLotStateMachine.can('SETTLEMENT_PENDING', 'UNSOLD')).toBe(true);
    });

    it('refuses to change a settled lot', () => {
      expect(AuctionLotStateMachine.isTerminal('SETTLED')).toBe(true);
    });

    it('refuses to select a winner before bidding closes', () => {
      expect(() => AuctionLotStateMachine.assert('BIDDING_OPEN', 'WINNER_SELECTED')).toThrow(
        AppException,
      );
    });
  });

  describe('BidStateMachine', () => {
    it('lets an accepted bid be outbid and then lost', () => {
      expect(() => BidStateMachine.assertPath('ACCEPTED', ['OUTBID', 'LOST'])).not.toThrow();
    });

    it('lets a winning bid become won', () => {
      expect(BidStateMachine.can('WINNING', 'WON')).toBe(true);
    });

    it('refuses to change a bid that has already won', () => {
      expect(BidStateMachine.isTerminal('WON')).toBe(true);
    });

    it('refuses to revive a retracted bid', () => {
      expect(BidStateMachine.isTerminal('RETRACTED')).toBe(true);
    });
  });
});
