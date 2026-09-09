import type { Config } from 'tailwindcss';

/**
 * YARDOS operational design language.
 *
 * Colours resolve to CSS custom properties defined in `app/globals.css`, not to
 * literal hex values. That indirection is what lets the console carry two
 * themes that are both designed rather than one theme and its inversion, and it
 * means a component never has to know which theme is active.
 *
 * The `<alpha-value>` placeholder lets Tailwind's opacity modifiers keep
 * working: `bg-primary/10` resolves correctly against the variable.
 *
 * Two rules govern use:
 *
 *   **Colour carries meaning, never decoration.** `primary` is a successful or
 *   active state and the primary action; `amber` is attention; `blue` is
 *   informational; `slate` is blocked or unknown; `danger` is critical. Nothing
 *   is coloured for emphasis alone.
 *
 *   **Colour is never the only signal.** Every status renders colour, an icon
 *   and a word, so it survives greyscale, low contrast and colour blindness.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--ground) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)',
          inverse: 'rgb(var(--ink-inverse) / <alpha-value>)',
        },

        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          strong: 'rgb(var(--primary-strong) / <alpha-value>)',
          soft: 'rgb(var(--primary-soft) / <alpha-value>)',
        },
        amber: {
          DEFAULT: 'rgb(var(--amber) / <alpha-value>)',
          strong: 'rgb(var(--amber-strong) / <alpha-value>)',
          soft: 'rgb(var(--amber-soft) / <alpha-value>)',
        },
        blue: {
          DEFAULT: 'rgb(var(--blue) / <alpha-value>)',
          strong: 'rgb(var(--blue-strong) / <alpha-value>)',
          soft: 'rgb(var(--blue-soft) / <alpha-value>)',
        },
        slate: {
          DEFAULT: 'rgb(var(--slate) / <alpha-value>)',
          strong: 'rgb(var(--slate-strong) / <alpha-value>)',
          soft: 'rgb(var(--slate-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          strong: 'rgb(var(--danger-strong) / <alpha-value>)',
          soft: 'rgb(var(--danger-soft) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Read character by character: plates, money, ids, timestamps, bays.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        raised: 'var(--shadow-raised)',
      },
      animation: {
        'pulse-soft': 'pulse-soft 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slide-up 160ms ease-out',
        'fade-in': 'fade-in 120ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
