import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'oklch(0.9 0 0)',
        input: 'oklch(0.9 0 0)',
        ring: 'oklch(0.22 0.08 165)',
        background: 'oklch(0.99 0 0)',
        foreground: 'oklch(0.15 0 0)',
        primary: {
          DEFAULT: '#023c2d',
          foreground: 'oklch(0.99 0 0)',
        },
        secondary: {
          DEFAULT: 'oklch(0.96 0 0)',
          foreground: 'oklch(0.15 0 0)',
        },
        destructive: {
          DEFAULT: 'oklch(0.55 0.22 25)',
          foreground: 'oklch(0.99 0 0)',
        },
        muted: {
          DEFAULT: 'oklch(0.96 0 0)',
          foreground: 'oklch(0.45 0 0)',
        },
        accent: {
          DEFAULT: 'oklch(0.22 0.08 165)',
          foreground: 'oklch(0.99 0 0)',
        },
        popover: {
          DEFAULT: 'oklch(1 0 0)',
          foreground: 'oklch(0.15 0 0)',
        },
        card: {
          DEFAULT: 'oklch(1 0 0)',
          foreground: 'oklch(0.15 0 0)',
        },
        success: '#023c2d',
        warning: '#eab308',
        info: '#3b82f6',
      },
      borderRadius: {
        lg: '0.5rem',
        md: 'calc(0.5rem - 2px)',
        sm: 'calc(0.5rem - 4px)',
      },
      fontFamily: {
        sans: ['Geist Sans', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
