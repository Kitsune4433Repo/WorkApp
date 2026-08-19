/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Soft Focus — muted plum accent, from the Style Lab direction.
        brand: {
          50: '#F5F1F9',
          100: '#EDE6F3',
          200: '#D9CCE3',
          300: '#BFA8CC',
          400: '#A488B3',
          500: '#8B6F9E',
          600: '#6E5580',
          700: '#5A4569',
          800: '#453552',
          900: '#33273D',
        },
        // Soft Focus's pale-lavender neutral scale, replacing Tailwind's default slate so every
        // existing bg-slate-*/text-slate-*/border-slate-* utility across the app picks it up.
        slate: {
          50: '#FAF9FC',
          100: '#F3F1F8',
          200: '#E9E5F1',
          300: '#D6D0E2',
          400: '#B3ABC4',
          500: '#9691A4',
          600: '#837C93',
          700: '#5C5568',
          800: '#3E3949',
          900: '#221F2B',
        },
      },
      fontFamily: {
        sans: ['Figtree', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        md: '10px',
        lg: '14px',
        xl: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(139,111,158,.06), 0 10px 24px -14px rgba(139,111,158,.28)',
        md: '0 2px 4px rgba(139,111,158,.06), 0 16px 32px -16px rgba(139,111,158,.3)',
      },
    },
  },
  plugins: [],
};
