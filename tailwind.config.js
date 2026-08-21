/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens driven by CSS variables (see styles/globals.css)
        bg: {
          base: 'rgb(var(--bg-base) / <alpha-value>)',
          raised: 'rgb(var(--bg-raised) / <alpha-value>)',
          overlay: 'rgb(var(--bg-overlay) / <alpha-value>)'
        },
        panel: 'rgb(var(--panel) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        hairline: 'rgb(var(--hairline) / <alpha-value>)',
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)'
        },
        speed: 'rgb(var(--speed) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        good: 'rgb(var(--good) / <alpha-value>)',
        purple: 'rgb(var(--purple) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
        display: ['"Rajdhani"', 'Inter', 'system-ui', 'sans-serif']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.02em' }]
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem'
      },
      boxShadow: {
        glass: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 8px 32px -8px rgb(0 0 0 / 0.6)',
        'glass-lg': '0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 24px 64px -16px rgb(0 0 0 / 0.7)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 0 24px -4px rgb(var(--accent) / 0.4)',
        'inner-hairline': '0 0 0 1px rgb(var(--hairline) / 0.6) inset'
      },
      backdropBlur: {
        xs: '2px'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--accent) / 0.5)' },
          '70%': { boxShadow: '0 0 0 8px rgb(var(--accent) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--accent) / 0)' }
        },
        'flash-purple': {
          '0%,100%': { backgroundColor: 'transparent' },
          '30%': { backgroundColor: 'rgb(var(--purple) / 0.22)' }
        },
        'flash-green': {
          '0%,100%': { backgroundColor: 'transparent' },
          '30%': { backgroundColor: 'rgb(var(--good) / 0.2)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
        'flash-purple': 'flash-purple 0.9s ease-out',
        'flash-green': 'flash-green 0.9s ease-out'
      }
    }
  },
  plugins: []
}
