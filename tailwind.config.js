/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Nunito"', 'system-ui', 'sans-serif'],
        body: ['"Nunito"', 'system-ui', 'sans-serif'],
      },
      colors: {
        steppe: {
          50: '#eef9ff',
          100: '#d9f1ff',
          200: '#bbe7ff',
          300: '#8bd9ff',
          400: '#54c2ff',
          500: '#2ca6ff',
          600: '#1186f5',
          700: '#0e6ce0',
          800: '#1158b6',
          900: '#144c8f',
        },
        sun: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        leaf: {
          400: '#58cc02',
          500: '#46a302',
          600: '#3a8b02',
        },
        ruby: {
          400: '#ff5b6c',
          500: '#ff2d4a',
          600: '#e0182f',
        },
        ink: {
          900: '#0b1530',
          800: '#142250',
          700: '#1d2f6f',
          500: '#4b5e8e',
          400: '#7a8ab8',
          300: '#aebbd9',
          200: '#d6dceb',
          100: '#eef1f8',
        },
      },
      boxShadow: {
        cartoon: '0 6px 0 0 rgba(0,0,0,0.12)',
        cartoonHover: '0 4px 0 0 rgba(0,0,0,0.12)',
        node: '0 8px 0 0 var(--node-shadow, #3a8b02)',
        soft: '0 10px 30px -10px rgba(11,21,48,0.18)',
      },
      animation: {
        wiggle: 'wiggle 0.6s ease-in-out',
        pop: 'pop 0.35s cubic-bezier(.2,1.6,.5,1)',
        float: 'float 4s ease-in-out infinite',
        shake: 'shake 0.4s',
        burst: 'burst 0.6s ease-out',
      },
      keyframes: {
        wiggle: {
          '0%,100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: 0 },
          '60%': { transform: 'scale(1.1)', opacity: 1 },
          '100%': { transform: 'scale(1)', opacity: 1 },
        },
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%,60%': { transform: 'translateX(-6px)' },
          '40%,80%': { transform: 'translateX(6px)' },
        },
        burst: {
          '0%': { transform: 'scale(0)', opacity: 1 },
          '100%': { transform: 'scale(2.4)', opacity: 0 },
        },
      },
    },
  },
  plugins: [],
}
