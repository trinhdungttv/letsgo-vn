/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        navy: {
          DEFAULT: '#0c2340',
          700: '#0f2d52',
          600: '#185FA5',
        },
      },
    },
  },
  plugins: [],
};
