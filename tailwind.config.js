/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        board: '#DCB878',
        boardDark: '#C8A060',
        boardBorder: '#8B5E1A',
        senteBlue: '#2563EB',
        goteRed: '#DC2626',
      },
    },
  },
  plugins: [],
}

