/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vanguard design tokens — sourced from Figma FS-ENTRY-1 design context
        'vg-ink':       '#040505',
        'vg-ink-muted': '#717777',
        'vg-red':       '#c8102e',
        'vg-teal':      '#00bda3',
        'vg-border':    '#e0e0e0',
        'vg-divider':   '#e8e8e8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'header': '0px 0px 2px rgba(4, 5, 5, 0.06)',
      },
    },
  },
  plugins: [],
}
