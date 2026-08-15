/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          50: '#f8f9fb',
          100: '#eef1f6',
          200: '#dfe4ec',
          300: '#c6cede',
          400: '#98a3b8',
          500: '#6b7891',
          600: '#4a5568',
          700: '#333c4d',
          800: '#232a37',
          850: '#1b212c',
          900: '#141922',
          950: '#0d1117',
        },
        accent: {
          400: '#4da3ff',
          500: '#1e88e5',
          600: '#1669bb',
        },
        axis: {
          red: '#d93b3b',
          green: '#2fa84f',
          blue: '#2f6fd0',
        },
      },
      fontFamily: {
        ui: ['"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 2px 12px rgba(0,0,0,0.28)',
        float: '0 8px 32px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
