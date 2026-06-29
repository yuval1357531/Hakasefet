/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: '#0D0D14',
          card: '#15151F',
          border: '#2A2A3C',
          gold: '#C9A84C',
          'gold-light': '#E8D5A0',
          'gold-dark': '#8B7332',
          text: '#F5F0E8',
          muted: '#8A8698',
        }
      },
      fontFamily: {
        sans: ['Heebo', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
