/**
 * Display formatting.
 *
 * These functions render values the API produced; none of them computes one.
 * The tests below exist because the failure mode is silent: a mis-grouped
 * amount is still a plausible number, and nobody notices until a financier
 * queries an invoice.
 */

import {
  formatAgeing,
  formatConfidence,
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatPlate,
  formatRelative,
  humanise,
} from './format';

describe('formatMoney', () => {
  describe('Indian digit grouping', () => {
    // Lakh/crore grouping: the last three digits, then pairs. Getting this
    // wrong turns Rs 1,23,456 into Rs 123,456 - a plausible-looking number
    // that is grouped like a different currency.
    it.each<[string, string]>([
      ['0', '₹0.00'],
      ['1', '₹1.00'],
      ['999', '₹999.00'],
      ['1000', '₹1,000.00'],
      ['99999', '₹99,999.00'],
      ['100000', '₹1,00,000.00'],
      ['1234567', '₹12,34,567.00'],
      ['12345678.9', '₹1,23,45,678.90'],
      ['2761.20', '₹2,761.20'],
    ])('formats %s as %s', (input, expected) => {
      expect(formatMoney(input)).toBe(expected);
    });
  });

  it('groups other currencies in threes', () => {
    expect(formatMoney('1234567', 'USD')).toBe('USD 1,234,567.00');
  });

  it('places the sign outside the grouping', () => {
    expect(formatMoney('-1234567')).toBe('-₹12,34,567.00');
  });

  it('shows an em dash for an absent amount, never "NaN" or "0"', () => {
    // Rendering a missing balance as zero would tell an operator a vehicle owes
    // nothing when the truth is that we do not know.
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('')).toBe('—');
    expect(formatMoney('not-a-number')).toBe('—');
  });

  it('accepts the decimal strings the API actually sends', () => {
    // The charge engine emits NUMERIC(18,4) as a string.
    expect(formatMoney('2761.2000')).toBe('₹2,761.20');
    expect(formatMoney('0.0000')).toBe('₹0.00');
  });
});

describe('formatMoneyCompact', () => {
  it.each<[string, string]>([
    ['500', '₹500'],
    ['1500', '₹1.5K'],
    ['150000', '₹1.50L'],
    ['12000000', '₹1.20Cr'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatMoneyCompact(input)).toBe(expected);
  });

  it('uses lakh and crore, not million', () => {
    expect(formatMoneyCompact('10000000')).toContain('Cr');
    expect(formatMoneyCompact('10000000')).not.toContain('M');
  });

  it('shows an em dash rather than a fabricated zero', () => {
    expect(formatMoneyCompact(null)).toBe('—');
  });
});

describe('formatPlate', () => {
  it.each<[string, string]>([
    ['TN09QQ7788', 'TN 09 QQ 7788'],
    ['tn09qq7788', 'TN 09 QQ 7788'],
    ['TN-09-QQ-7788', 'TN 09 QQ 7788'],
    ['TN 09 QQ 7788', 'TN 09 QQ 7788'],
    ['KA05C1234', 'KA 05 C 1234'],
    ['DL8CAF5030', 'DL 8 CAF 5030'],
  ])('renders %s as "%s"', (input, expected) => {
    expect(formatPlate(input)).toBe(expected);
  });

  it('renders every rendering of one plate identically', () => {
    // The same physical car must never look like two vehicles in a list.
    const renderings = ['TN09QQ7788', 'tn09qq7788', 'TN-09-QQ-7788', 'TN 09 QQ 7788'];
    const rendered = new Set(renderings.map(formatPlate));
    expect(rendered.size).toBe(1);
  });

  it('handles a BH series plate', () => {
    expect(formatPlate('22BH1234AA')).toBe('22 BH 1234 AA');
  });

  it('passes through a plate it cannot parse rather than mangling it', () => {
    // A foreign or malformed plate is still an identifier; better shown
    // unspaced than silently truncated.
    expect(formatPlate('WEIRDPLATE999X')).toBe('WEIRDPLATE999X');
  });

  it('shows an em dash for nothing', () => {
    expect(formatPlate(null)).toBe('—');
    expect(formatPlate('')).toBe('—');
  });
});

describe('formatAgeing', () => {
  it.each<[number, string]>([
    [0, 'today'],
    [1, '1 day'],
    [28, '28 days'],
    [30, '1 month'],
    [47, '1mo 17d'],
  ])('renders %s days as "%s"', (days, expected) => {
    expect(formatAgeing(days)).toBe(expected);
  });

  it('singularises one day', () => {
    expect(formatAgeing(1)).toBe('1 day');
    expect(formatAgeing(2)).toBe('2 days');
  });

  it('shows an em dash for an unknown age', () => {
    expect(formatAgeing(null)).toBe('—');
  });
});

describe('formatRelative', () => {
  it('describes a recent instant in seconds', () => {
    expect(formatRelative(new Date(Date.now() - 5_000).toISOString())).toBe('just now');
    expect(formatRelative(new Date(Date.now() - 30_000).toISOString())).toMatch(/^\d+s ago$/);
  });

  it('escalates through minutes, hours and days', () => {
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(formatRelative(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
    expect(formatRelative(new Date(Date.now() - 4 * 86_400_000).toISOString())).toBe('4d ago');
  });

  it('shows an em dash for an unparseable timestamp', () => {
    expect(formatRelative('not-a-date')).toBe('—');
    expect(formatRelative(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('renders a date deterministically', () => {
    expect(formatDate('2026-03-10T00:00:00Z')).toMatch(/\d{2} \w{3} 2026/);
  });

  it('shows an em dash for nothing', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nonsense')).toBe('—');
  });
});

describe('formatConfidence', () => {
  it('renders an ANPR confidence as a percentage', () => {
    expect(formatConfidence(0.982)).toBe('98.2%');
    expect(formatConfidence('0.85')).toBe('85.0%');
  });

  it('shows an em dash rather than implying total confidence', () => {
    // A missing confidence must never render as 0% or 100%.
    expect(formatConfidence(null)).toBe('—');
    expect(formatConfidence('bad')).toBe('—');
  });
});

describe('formatPercent', () => {
  it('renders one decimal place', () => {
    expect(formatPercent(82.456)).toBe('82.5%');
  });

  it('shows an em dash for nothing', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });
});

describe('humanise', () => {
  it('renders an enum as a sentence', () => {
    expect(humanise('AWAITING_APPROVAL')).toBe('Awaiting approval');
  });

  it('shows an em dash for nothing', () => {
    expect(humanise(null)).toBe('—');
  });
});
