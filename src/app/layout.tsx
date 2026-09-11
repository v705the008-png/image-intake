import type { Metadata, Viewport } from 'next';
import { MotionProvider } from '@/components/MotionProvider';
import './globals.css';

export const metadata: Metadata = {
  title: '画像アップローダー | 入稿データ受付',
  description:
    'タペストリー・ポスター・ステッカーの印刷用に、圧縮されていない元の画像をそのままお預かりします。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
