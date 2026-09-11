import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ベース（ミニマル白基調）
        bg: '#ffffff',
        surface: '#ffffff',
        surface2: '#f6f6f7',
        surface3: '#efeff1',
        line: '#e4e4e7',
        lineStrong: '#c9c9cf',
        ink: '#111113',
        sub: '#6b6b75',
        faint: '#9a9aa4',
        // ブランドアクセント（インクブルー / 1色のみ）
        accent: '#2a4bff',
        accentInk: '#1a32c4',
        accentSoft: '#eef1ff',
        // セマンティック
        ok: '#12a150',
        okSoft: '#e7f6ed',
        warn: '#b45309',
        warnSoft: '#fdf4e3',
        // イラスト内の断裁線と同じ赤。エラー表示はこの色で統一する。
        ng: '#ff2d55',
        ngSoft: '#ffeef1',
      },
      borderRadius: {
        pill: '999px',
        card: '18px',
        hero: '26px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(17,17,19,.05), 0 8px 24px rgba(17,17,19,.06)',
        lift: '0 2px 6px rgba(17,17,19,.07), 0 18px 48px rgba(17,17,19,.10)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Hiragino Sans"',
          '"Hiragino Kaku Gothic ProN"',
          '"Noto Sans JP"',
          'Meiryo',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
