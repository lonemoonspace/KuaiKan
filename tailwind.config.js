import animate from 'tailwindcss-animate';
import defaultTheme from 'tailwindcss/defaultTheme';

/**
 * The summary panel runs inside a Shadow DOM, where rem units still resolve
 * against the HOST PAGE's <html> root font-size — not against the panel or its
 * :host base (font-size: 13px). Websites that change the root font-size (e.g.
 * rem-layouts with `html { font-size: 62.5% }`, or 18–20px accessibility
 * sites) would otherwise rescale every rem-based font and spacing inside the
 * panel.
 *
 * To make the panel pixel-identical on every page, pin the fontSize and
 * spacing scales to px values that match the Tailwind defaults at a 16px root.
 * Options/popup pages run in their own documents with a 16px root, so their
 * rendering is unchanged; only the rem-to-page-root dependency is removed.
 */
const toPx = (value) =>
  value === '0' || value.endsWith('px') ? value : `${parseFloat(value) * 16}px`;

const pxFontSizes = Object.fromEntries(
  Object.entries(defaultTheme.fontSize).map(([key, value]) => {
    const [size, lineHeight] = Array.isArray(value) ? value : [value];
    if (lineHeight === undefined) return [key, toPx(size)];
    if (typeof lineHeight === 'string') return [key, [toPx(size), lineHeight]];
    return [key, [toPx(size), { lineHeight: toPx(lineHeight.lineHeight) }]];
  })
);

const pxSpacing = Object.fromEntries(
  Object.entries(defaultTheme.spacing).map(([key, value]) => [key, toPx(value)])
);

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './entrypoints/**/*.{html,ts,tsx}',
    './components/**/*.{ts,tsx}',
    './constants/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    fontSize: pxFontSizes,
    spacing: pxSpacing,
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [animate],
}
