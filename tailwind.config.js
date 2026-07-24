/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Ưu tiên font hệ thống kiểu Apple (San Francisco trên Mac/iOS) — không phải web
        // font riêng của app, để giao diện có cảm giác "chuẩn Apple" thật sự trên máy đó;
        // các nền tảng khác rơi về font hệ thống tương ứng (Segoe UI/Windows…), cuối cùng
        // mới tới Inter làm phương án dự phòng.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text',
          'Segoe UI', 'Roboto', 'Helvetica Neue', 'Inter', 'Arial', 'sans-serif',
        ],
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
