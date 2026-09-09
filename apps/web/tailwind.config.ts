import type { Config } from 'tailwindcss';

/**
 * YARDOS operational design language.
 *
 * The palette is built for a control room, not a marketing site. Three
 * decisions shape it:
 *
 *   **Dark by default.** Gate consoles run for a whole shift, often on screens
 *   in bright yards behind glass. A near-black ground with restrained contrast
 *   is easier to read for eight hours than a white one.
 *
 *   **Colour carries meaning, not decoration.** Green means available or
 *   settled, amber means occupied or awaiting attention, red means blocked or
 *   failed, blue means informational. An operator should be able to read state
 *   from colour alone at a glance, so colour is never used for emphasis.
 *
 *   **Restraint.** One cyan accent for interaction. No neon, no glow beyond a
 *   subtle ring on live elements. Anything that competes with the status
 *   colours actively harms the screen's job.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Ground: near-black navy, stepped so panels separate without borders
        // doing all the work.
        base: {
          950: '#070b14',
          900: '#0b1220',
          850: '#0f1729',
          800: '#131d33',
          750: '#18243d',
          700: '#1e2c48',
          600: '#293a5c',
          500: '#3b4f76',
        },
        // Interaction accent.
        accent: {
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
        },
        // Semantic status. These are the only colours that carry meaning.
        ok: { 400: '#34d399', 500: '#10b981', 600: '#059669' },
        warn: { 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
        danger: { 400: '#f87171', 500: '#ef4444', 600: '#dc2626' },
        info: { 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb' },
        muted: { 400: '#94a3b8', 500: '#64748b', 600: '#475569' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Registration numbers, money and identifiers are read character by
        // character, so they get a monospace face.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      borderRadius: {
        panel: '0.625rem',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        raised: '0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
      },
      animation: {
        'pulse-soft': 'pulse-soft 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slide-in 180ms ease-out',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
