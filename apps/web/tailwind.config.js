export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172554',
        canvas: '#f6f8fc',
        line: '#e6eaf2',
        muted: '#64748b',
        brand: { 50: '#eef4ff', 100: '#dce8ff', 500: '#4f71e8', 600: '#3f5fd1', 700: '#334db0' }
      },
      boxShadow: { soft: '0 12px 32px rgba(23, 37, 84, .06)' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
