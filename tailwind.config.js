/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        warm: {
          50:  '#fef8ee',
          100: '#fef0d6',
          200: '#fcddab',
          300: '#f9c47a',
          400: '#f5a544',
          500: '#f28c1c',
          600: '#e37412',
          700: '#bd5910',
          800: '#964615',
          900: '#793b15',
        },
        cafe: {
          light: '#d4a574',
          DEFAULT: '#8B5E3C',
          dark:  '#3E2723',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body:    ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(245, 165, 68, 0.15)',
      },
    },
  },
  plugins: [],
}
