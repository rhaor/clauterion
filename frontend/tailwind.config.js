/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          light: '#ffe1d6',
          DEFAULT: '#f59e8b',
          dark: '#ef7f5f',
        },
        sand: {
          50: '#fdf7f1',
          100: '#f6eadd',
          200: '#e7d6c2',
        },
      },
    },
  },
  plugins: [],
}

