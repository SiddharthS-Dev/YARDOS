/**
 * The status vocabulary.
 *
 * This map is the reason a stay, an invoice, a bid and a registry lookup all
 * look consistent. A mistake here is invisible in review and wrong on every
 * screen simultaneously - showing an operator a green badge where the system
 * said the vehicle is blocked, which is exactly the misread that lets a vehicle
 * leave when it should not have.
 */

import {
  AGE_SEVERITY_VISUAL,
  STATUS_VISUALS,
  ageSeverity,
  humanise,
  registryExplanation,
  statusVisual,
  type StatusKind,
} from './status';

describe('statusVisual', () => {
  it('always returns colour, an icon and a fill', () => {
    // Colour alone fails in greyscale, for a colour-blind operator, and on a
    // sun-washed gate screen. The icon is not optional.
    for (const kind of Object.keys(STATUS_VISUALS) as StatusKind[]) {
      const visual = STATUS_VISUALS[kind];
      expect(visual.icon).toBeTruthy();
      expect(visual.badge).toMatch(/bg-/);
      expect(visual.text).toMatch(/text-/);
      expect(visual.fill).toMatch(/bg-/);
    }
  });

  it('is case-insensitive, because APIs and fixtures disagree about case', () => {
    expect(statusVisual('open').kind).toBe(statusVisual('OPEN').kind);
  });

  it('resolves an unmapped status to UNKNOWN rather than to success', () => {
    // The failure mode this prevents: a new backend status silently rendering
    // green because the default happened to be the first entry.
    expect(statusVisual('SOME_NEW_BACKEND_STATE').kind).toBe('UNKNOWN');
    expect(statusVisual(null).kind).toBe('UNKNOWN');
    expect(statusVisual(undefined).kind).toBe('UNKNOWN');
    expect(statusVisual('').kind).toBe('UNKNOWN');
  });

  describe('states that must never read as good news', () => {
    it.each(['ON_HOLD', 'ELIGIBILITY_FAILED', 'SUSPENDED', 'MAINTENANCE', 'LOCKED'])(
      '%s is BLOCKED',
      (status) => {
        expect(statusVisual(status).kind).toBe('BLOCKED');
      },
    );

    it.each(['FAILED', 'REJECTED', 'OFFLINE', 'OVERDUE'])('%s is CRITICAL', (status) => {
      expect(statusVisual(status).kind).toBe('CRITICAL');
    });

    it.each(['UNMATCHED', 'AMBIGUOUS', 'PARTIALLY_PAID', 'UNAVAILABLE', 'DEGRADED'])(
      '%s is WARNING, not success',
      (status) => {
        expect(statusVisual(status).kind).toBe('WARNING');
      },
    );

    it('does not treat an ambiguous financier match as matched', () => {
      // Attaching a vehicle to the wrong lender means invoicing the wrong
      // company and showing one financier another's asset.
      expect(statusVisual('AMBIGUOUS').kind).not.toBe('SUCCESS');
      expect(statusVisual('UNMATCHED').kind).not.toBe('SUCCESS');
    });
  });

  describe('states that are genuinely settled', () => {
    it.each(['PAID', 'SUCCESS', 'SETTLED', 'RECEIVED', 'MATCHED', 'VERIFIED', 'COMPLETED'])(
      '%s is SUCCESS',
      (status) => {
        expect(statusVisual(status).kind).toBe('SUCCESS');
      },
    );

    it('renders every settled state identically', () => {
      // The whole point of one vocabulary: PAID and SETTLED cannot drift apart.
      const paid = statusVisual('PAID');
      const settled = statusVisual('SETTLED');
      expect(settled.badge).toBe(paid.badge);
      expect(settled.icon).toBe(paid.icon);
    });
  });

  it('separates a live stay from a finished one', () => {
    expect(statusVisual('OPEN').kind).toBe('ACTIVE');
    expect(statusVisual('CLOSED').kind).toBe('COMPLETED');
    expect(statusVisual('OPEN').badge).not.toBe(statusVisual('CLOSED').badge);
  });

  it('keeps a superseded bid visually distinct from the winning one', () => {
    expect(statusVisual('WON').kind).toBe('SUCCESS');
    expect(statusVisual('OUTBID').kind).toBe('EXPIRED');
    expect(statusVisual('LOST').kind).toBe('EXPIRED');
  });
});

describe('registryExplanation', () => {
  it('never claims a mock provider verified anything', () => {
    // The one sentence in the console that must not overstate provenance.
    for (const status of ['PENDING', 'UNAVAILABLE', 'FAILED', 'NOT_REQUESTED']) {
      expect(registryExplanation(status).toLowerCase()).not.toContain('confirmed');
    }
  });

  it('distinguishes registry confirmation from staff confirmation', () => {
    expect(registryExplanation('VERIFIED')).toMatch(/registry/i);
    expect(registryExplanation('MANUALLY_VERIFIED')).toMatch(/manually|staff/i);
    expect(registryExplanation('MANUALLY_VERIFIED')).toMatch(/not by the registry/i);
  });

  it('says a pending lookup does not hold up admission', () => {
    // The gate never waits for the registry, and the wording has to say so or
    // an operator will wait anyway.
    expect(registryExplanation('PENDING')).toMatch(/does not wait/i);
  });

  it('does not read as though the operator caused an unavailable lookup', () => {
    expect(registryExplanation('UNAVAILABLE')).not.toMatch(/error|invalid|you /i);
  });

  it('has a sentence for every state, including unrecognised ones', () => {
    for (const status of [
      'VERIFIED',
      'MANUALLY_VERIFIED',
      'PENDING',
      'UNAVAILABLE',
      'FAILED',
      'NOT_REQUESTED',
      'SOMETHING_ELSE',
      null,
    ]) {
      expect(registryExplanation(status).length).toBeGreaterThan(10);
    }
  });
});

describe('ageSeverity', () => {
  it.each<[number, string]>([
    [0, 'NORMAL'],
    [7, 'NORMAL'],
    [8, 'WATCH'],
    [15, 'WATCH'],
    [16, 'WARNING'],
    [30, 'WARNING'],
    [31, 'CRITICAL'],
    [400, 'CRITICAL'],
  ])('%s days is %s', (days, expected) => {
    expect(ageSeverity(days)).toBe(expected);
  });

  it('treats an unknown age as normal rather than alarming', () => {
    expect(ageSeverity(null)).toBe('NORMAL');
    expect(ageSeverity(undefined)).toBe('NORMAL');
  });

  it('gives every severity a word, not only a colour', () => {
    for (const severity of ['NORMAL', 'WATCH', 'WARNING', 'CRITICAL'] as const) {
      expect(AGE_SEVERITY_VISUAL[severity].label).toBeTruthy();
      expect(STATUS_VISUALS[AGE_SEVERITY_VISUAL[severity].kind].icon).toBeTruthy();
    }
  });

  it('escalates monotonically', () => {
    // A vehicle that has been here longer can never be shown as less urgent.
    const order = { NORMAL: 0, WATCH: 1, WARNING: 2, CRITICAL: 3 };
    let previous = -1;
    for (const days of [0, 5, 8, 12, 16, 25, 31, 90]) {
      const current = order[ageSeverity(days)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('humanise', () => {
  it.each<[string, string]>([
    ['AWAITING_APPROVAL', 'Awaiting approval'],
    ['IN_YARD', 'In yard'],
    ['PARTIALLY_PAID', 'Partially paid'],
    ['OPEN', 'Open'],
    ['WINNER_SELECTED', 'Winner selected'],
  ])('renders %s as "%s"', (input, expected) => {
    expect(humanise(input)).toBe(expected);
  });

  it('renders an em dash for nothing, rather than "undefined"', () => {
    expect(humanise(null)).toBe('—');
    expect(humanise(undefined)).toBe('—');
    expect(humanise('')).toBe('—');
  });
});
