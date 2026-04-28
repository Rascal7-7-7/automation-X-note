import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SNS自動化 ダッシュボード',
  description: 'SNS副業自動化システム 管理ダッシュボード v2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
