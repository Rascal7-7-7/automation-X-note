import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d0d0d',
        card: '#161616',
        border: '#262626',
        accent: '#7c6ff7',
      },
      fontFamily: { mono: ['JetBrains Mono', 'Fira Code', 'monospace'] },
    },
  },
};

export default config;
