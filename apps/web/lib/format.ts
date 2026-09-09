/**
 * Display formatting.
 *
 * The console NEVER computes a monetary value. Amounts arrive from the API as
 * decimal strings produced by the charge engine, and these helpers only render
 * them. Requirement S35: financial calculation is server-side and
 * authoritative; duplicating it in the browser would create a second source of
 * truth that can disagree.
 */

/** Indian digit grouping: 1,23,45,678.90. */
export function formatMoney(amount: string | number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return '—';

  const negative = value < 0;
  const [whole = '0', fraction = '00'] = Math.abs(value).toFixed(2).split('.');
  const grouped =
    currency === 'INR'
      ? whole.length <= 3
        ? whole
        : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`
      : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${negative ? '-' : ''}${currency === 'INR' ? '₹' : `${currency} `}${grouped}.${fraction}`;
}

/** Compact form for dashboard tiles: ₹1.2L, ₹3.4Cr. */
export function formatMoneyCompact(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return '—';

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Groups a plate for display: TN01AB1234 -> TN 01 AB 1234. */
export function formatPlate(plate: string | null | undefined): string {
  if (!plate) return '—';
  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const state = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(normalized);
  if (state) return [state[1], state[2], state[3], state[4]].filter(Boolean).join(' ');
  const bh = /^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/.exec(normalized);
  if (bh) return `${bh[1]} ${bh[2]} ${bh[3]} ${bh[4]}`;
  return normalized;
}

/** Local date and time in the viewer's zone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** "3 minutes ago", "2 days ago". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Ageing in a form an operator reads at a glance. */
export function formatAgeing(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  const remainder = days % 30;
  if (remainder > 0) return `${months}mo ${remainder}d`;
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** SNAKE_CASE enum -> "Snake case", for labels. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

/** Confidence 0..1 -> "98.2%". */
export function formatConfidence(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(number)) return '—';
  return `${(number * 100).toFixed(1)}%`;
}
