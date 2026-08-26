/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        doom: {
          bg: '#121212',
          card: '#181818',
          cardAlt: '#202020',
          hud: '#222222',
          hudDark: '#141414',
          border: '#3c3c3c',
          bevelLight: '#5a5a5a',
          bevelDark: '#0e0e0e',
          gold: '#d49b00',
          goldBright: '#ffd700',
          slime: '#00ff41',
          cyan: '#00e5ff',
          bfg: '#55ff55',
          blood: '#ff4444',
          bloodBg: '#320a0a',
          bloodTint: 'rgba(255, 68, 68, 0.12)',
          white: '#f0f0f0',
          dim: '#888888',
        }
      },
      fontFamily: {
        mono: ['"Monaspace Argon"', '"JetBrains Mono"', '"Cascadia Code"', '"Fira Code"', 'Consolas', 'Menlo', 'monospace'],
        doom: ['"Press Start 2P"', 'monospace', 'sans-serif'],
      },
      boxShadow: {
        'doom-bevel': 'inset 2px 2px 0px rgba(255,255,255,0.15), inset -2px -2px 0px rgba(0,0,0,0.7)',
        'doom-bevel-sm': 'inset 1px 1px 0px rgba(255,255,255,0.2), inset -1px -1px 0px rgba(0,0,0,0.8)',
        'doom-inset': 'inset 2px 2px 4px rgba(0,0,0,0.8)',
        'doom-glow': '0 0 10px rgba(212, 155, 0, 0.3)',
        'doom-glow-green': '0 0 10px rgba(0, 255, 65, 0.3)',
        'doom-glow-red': '0 0 10px rgba(255, 68, 68, 0.3)',
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
