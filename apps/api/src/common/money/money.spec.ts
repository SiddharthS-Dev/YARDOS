/**
 * Money primitives.
 *
 * Everything downstream - the charge ladder, invoice totals, payment balances,
 * auction settlements - is built on these functions. A defect here is a defect
 * in every rupee figure the platform produces, so the cases below are the ones
 * that would actually go wrong: binary floating point, rounding at the wrong
 * moment, and Indian digit grouping.
 */

import { Prisma } from '@prisma/client';

import {
  DEFAULT_CURRENCY,
  Decimal,
  MONEY_SCALE,
  UNIT_SCALE,
  ZERO,
  addMoney,
  amountInWords,
  compareMoney,
  equalsMoney,
  formatMoney,
  isNegative,
  isPositive,
  isZero,
  maxMoney,
  minMoney,
  money,
  moneyToString,
  multiplyMoney,
  subtractMoney,
  sumExact,
  toDecimal,
  toPrismaDecimal,
  units,
  unitsToPrismaDecimal,
  unitsToString,
} from './money';

describe('toDecimal', () => {
  it('treats null and undefined as zero', () => {
    expect(toDecimal(null).toNumber()).toBe(0);
    expect(toDecimal(undefined).toNumber()).toBe(0);
  });

  it('passes a Decimal through unchanged', () => {
    const value = new Decimal('123.4567');
    expect(toDecimal(value)).toBe(value);
  });

  it('accepts a decimal string exactly', () => {
    expect(toDecimal('123.4567').toFixed(4)).toBe('123.4567');
  });

  it('accepts a Prisma.Decimal', () => {
    expect(toDecimal(new Prisma.Decimal('99.99')).toFixed(2)).toBe('99.99');
  });

  it('converts a number via its literal, not its binary approximation', () => {
    // new Decimal(0.1) from a double would carry the IEEE-754 error; going
    // through String(0.1) preserves what the developer actually wrote.
    expect(toDecimal(0.1).toFixed(20)).toBe('0.10000000000000000000');
  });

  it('refuses a non-finite number rather than producing NaN money', () => {
    // A NaN that reaches an invoice total is far worse than a thrown error.
    expect(() => toDecimal(Number.NaN)).toThrow(TypeError);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => toDecimal(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('scales', () => {
  it('rounds money to 4 places, half up', () => {
    expect(money('1.00005').toFixed(MONEY_SCALE)).toBe('1.0001');
    expect(money('1.00004').toFixed(MONEY_SCALE)).toBe('1.0000');
  });

  it('rounds half away from zero, not to even', () => {
    // Banker's rounding would give 1.0000 here and under-bill half the time.
    expect(money('1.00005').toFixed(4)).toBe('1.0001');
    expect(money('1.00015').toFixed(4)).toBe('1.0002');
  });

  it('keeps units at 6 places, for fractional days', () => {
    expect(units('1.0833333333').toFixed(UNIT_SCALE)).toBe('1.083333');
  });

  it('renders fixed-scale strings for the wire', () => {
    expect(moneyToString('100.5')).toBe('100.5000');
    expect(unitsToString('2')).toBe('2.000000');
  });

  it('exposes a shared zero', () => {
    expect(ZERO.toNumber()).toBe(0);
  });
});

describe('conversion to Prisma decimals', () => {
  it('produces a Prisma.Decimal at money scale', () => {
    const value = toPrismaDecimal('100.55555');
    expect(value).toBeInstanceOf(Prisma.Decimal);
    expect(value.toFixed(4)).toBe('100.5556');
  });

  it('produces a Prisma.Decimal at unit scale', () => {
    expect(unitsToPrismaDecimal('1.0833333333').toFixed(6)).toBe('1.083333');
  });
});

describe('arithmetic', () => {
  it('adds without binary floating-point error', () => {
    // The canonical example. 0.1 + 0.2 === 0.30000000000000004 as doubles.
    expect(addMoney(0.1, 0.2).toFixed(4)).toBe('0.3000');
  });

  it('adds any number of values', () => {
    expect(addMoney('1.10', '2.20', '3.30').toFixed(2)).toBe('6.60');
    expect(addMoney().toNumber()).toBe(0);
  });

  it('subtracts exactly', () => {
    expect(subtractMoney('0.3', '0.1').toFixed(4)).toBe('0.2000');
    expect(subtractMoney('100', '150').toFixed(2)).toBe('-50.00');
  });

  it('multiplies a rate by a quantity', () => {
    expect(multiplyMoney('100.50', 40).toFixed(2)).toBe('4020.00');
  });

  it('multiplies a fractional rate without drift', () => {
    expect(multiplyMoney('0.1', 3).toFixed(4)).toBe('0.3000');
  });

  describe('sumExact', () => {
    it('sums without rounding at each step', () => {
      // This is the accumulation defect it exists to prevent: forty lines each
      // rounded up produce a total visibly larger than the sum a financier
      // computes from the printed line amounts.
      const lines = Array.from({ length: 40 }, () => '0.005');

      const exact = sumExact(lines);
      const roundedEachStep = lines.reduce(
        (sum, line) => addMoney(sum, money(line).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
        ZERO,
      );

      expect(exact.toFixed(4)).toBe('0.2000');
      expect(roundedEachStep.toFixed(4)).toBe('0.4000');
      expect(exact.equals(roundedEachStep)).toBe(false);
    });

    it('returns zero for no values', () => {
      expect(sumExact([]).toNumber()).toBe(0);
    });
  });
});

describe('predicates', () => {
  it.each<[string, boolean]>([
    ['0', true],
    ['0.0000', true],
    ['0.0001', false],
    ['-0.0001', false],
  ])('isZero(%s) is %s', (value, expected) => {
    expect(isZero(value)).toBe(expected);
  });

  it('distinguishes negative, zero and positive', () => {
    expect(isNegative('-1')).toBe(true);
    expect(isNegative('0')).toBe(false);
    expect(isPositive('1')).toBe(true);
    expect(isPositive('0')).toBe(false);
    expect(isPositive('-1')).toBe(false);
  });

  it('compares as -1, 0, 1', () => {
    expect(compareMoney('1', '2')).toBe(-1);
    expect(compareMoney('2', '2')).toBe(0);
    expect(compareMoney('3', '2')).toBe(1);
  });

  it('treats equal values written differently as equal', () => {
    expect(equalsMoney('1.5', '1.50')).toBe(true);
    expect(equalsMoney('1.5', 1.5)).toBe(true);
    expect(equalsMoney('1.5', '1.51')).toBe(false);
  });

  it('picks the larger and smaller of two amounts', () => {
    expect(maxMoney('10', '20').toFixed(2)).toBe('20.00');
    expect(minMoney('10', '20').toFixed(2)).toBe('10.00');
    expect(maxMoney('-10', '-20').toFixed(2)).toBe('-10.00');
  });
});

describe('formatMoney', () => {
  describe('Indian digit grouping', () => {
    // Lakh/crore grouping: the last three digits, then pairs.
    it.each<[string, string]>([
      ['0', '0.00'],
      ['1', '1.00'],
      ['999', '999.00'],
      ['1000', '1,000.00'],
      ['99999', '99,999.00'],
      ['100000', '1,00,000.00'],
      ['1234567', '12,34,567.00'],
      ['12345678.9', '1,23,45,678.90'],
      ['100000000', '10,00,00,000.00'],
    ])('formats %s as %s', (input, expected) => {
      expect(formatMoney(input)).toBe(expected);
    });

    it('is the default currency', () => {
      expect(DEFAULT_CURRENCY).toBe('INR');
      expect(formatMoney('1234567')).toBe(formatMoney('1234567', 'INR'));
    });
  });

  describe('western grouping for other currencies', () => {
    it.each<[string, string]>([
      ['1000', '1,000.00'],
      ['1234567', '1,234,567.00'],
      ['12345678.9', '12,345,678.90'],
    ])('formats %s as %s', (input, expected) => {
      expect(formatMoney(input, 'USD')).toBe(expected);
    });
  });

  it('places the sign outside the grouping', () => {
    expect(formatMoney('-1234567')).toBe('-12,34,567.00');
  });

  it('rounds to two places for display', () => {
    expect(formatMoney('1.005')).toBe('1.01');
    expect(formatMoney('1.004')).toBe('1.00');
  });
});

describe('amountInWords', () => {
  it.each<[string, string]>([
    ['0', 'Rupees Zero only'],
    ['1', 'Rupees One only'],
    ['15', 'Rupees Fifteen only'],
    ['20', 'Rupees Twenty only'],
    ['21', 'Rupees Twenty One only'],
    ['100', 'Rupees One Hundred only'],
    ['101', 'Rupees One Hundred One only'],
    ['999', 'Rupees Nine Hundred Ninety Nine only'],
    ['1000', 'Rupees One Thousand only'],
    ['100000', 'Rupees One Lakh only'],
    ['10000000', 'Rupees One Crore only'],
  ])('spells %s as "%s"', (input, expected) => {
    expect(amountInWords(input)).toBe(expected);
  });

  it('spells a realistic invoice total', () => {
    expect(amountInWords('2761.20')).toBe(
      'Rupees Two Thousand Seven Hundred Sixty One and Twenty Paise only',
    );
  });

  it('gives paise numerically spelled, not as a decimal', () => {
    expect(amountInWords('1.50')).toBe('Rupees One and Fifty Paise only');
  });

  it('omits the paise clause when there are none', () => {
    expect(amountInWords('1.00')).toBe('Rupees One only');
  });

  it('uses generic unit names for a non-INR currency', () => {
    expect(amountInWords('1.25', 'USD')).toBe('USD One and Twenty Five Cents only');
  });

  it('spells a crore-scale amount with all groups', () => {
    // 1,23,45,678
    expect(amountInWords('12345678')).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight only',
    );
  });

  it('treats a negative amount by magnitude', () => {
    // The sign belongs on the figure, not spelled into the words.
    expect(amountInWords('-500')).toBe('Rupees Five Hundred only');
  });
});
