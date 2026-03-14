import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'LumenBro Agents',
  description: 'Self-custodial AI agent wallets on Stellar. On-chain spend policies, pluggable signers, x402 payments.',
  openGraph: {
    title: 'LumenBro Agents',
    description: 'Self-custodial AI agent wallets on Stellar with on-chain spend policies.',
    images: [{ url: '/og-icon.png', width: 512, height: 512 }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
