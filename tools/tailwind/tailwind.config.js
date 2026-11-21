/** Configuración idéntica a la del CDN que usaba la landing */
module.exports = {
  darkMode: 'class',
  content: ['../../public/landing.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Nunito', 'system-ui', 'sans-serif'], display: ['Montserrat', 'system-ui', 'sans-serif'] },
      colors: { brand: { cobalt: '#1D4ED8', royal: '#2563EB', navy: '#0F172A', deep: '#1E3A8A', sky: '#0EA5E9', night: '#0B1120', emerald: '#10B981' } },
      boxShadow: { 'glow-blue': '0 14px 36px -10px rgba(29, 78, 216, 0.35)', 'glow-emerald': '0 14px 32px -10px rgba(16, 185, 129, 0.35)' },
    },
  },
};
