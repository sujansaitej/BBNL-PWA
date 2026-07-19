
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: { 
    extend: {
      fontFamily: {
        sans: ["Poppins", "sans-serif"],
      },
      // `70` was used across the app (w-70/h-70: Sidebar drawer, modal
      // images) but never defined, so those classes silently did nothing.
      // 17.5rem keeps the standard scale (w-64=16rem, w-72=18rem).
      spacing: {
        70: "17.5rem",
      },
      keyframes: {
        wave: {
          '0%':   { transform: 'scale(1)',   opacity: '0.4' },
          '70%':  { transform: 'scale(1.5)', opacity: '0' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
      },
      animation: {
        wave: 'wave 1s ease-out',
      },
    } 
  },
  plugins: []
}
