import type { Config } from 'tailwindcss';

// Palette follows the product brief (warm off-white, sage green, charcoal), with muted/border values
// adjusted so small text meets WCAG AA contrast on the background.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F8F7F4',
        surface: '#FFFFFF',
        sunken: '#F1F0EB',
        primary: { DEFAULT: '#355F52', hover: '#294A40', soft: '#E8F0EC', ring: '#9DB5A8' },
        ink: { DEFAULT: '#26342F', soft: '#3F4D47' },
        muted: '#66726B',
        line: { DEFAULT: '#E3E8E2', strong: '#CBD3CC' },
        warn: { DEFAULT: '#8A5A12', soft: '#FBF3E4', line: '#EBD7AE' },
        danger: { DEFAULT: '#A83A2A', soft: '#FBEDEA', line: '#EFC7BF' },
        rec: '#C2402D',
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', '"Source Han Sans SC"', 'system-ui', 'sans-serif'],
        serif: ['"Source Han Serif SC"', '"Noto Serif SC"', '"Songti SC"', '"STSong"', '"SimSun"', 'serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(38,52,47,0.04), 0 4px 16px rgba(38,52,47,0.04)',
        pop: '0 8px 32px rgba(38,52,47,0.14)',
      },
      borderRadius: { xl2: '14px' },
    },
  },
  plugins: [],
} satisfies Config;
