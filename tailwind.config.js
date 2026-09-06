/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Monaspace Argon"', '"JetBrains Mono"', '"Cascadia Code"', '"Fira Code"', 'Consolas', 'Menlo', '"Symbols Nerd Font Mono"', '"Symbols Nerd Font"', '"Nerd Font"', 'monospace'],
      },
      animation: {
        'phosphor-pulse': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash-red': 'flashRed 0.3s ease-out',
        'flash-gold': 'flashGold 0.3s ease-out',
      },
      keyframes: {
        flashRed: {
          '0%': { backgroundColor: 'rgba(255, 68, 68, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashGold: {
          '0%': { backgroundColor: 'rgba(212, 155, 0, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        }
      }
    },
  },
  plugins: [],
}
