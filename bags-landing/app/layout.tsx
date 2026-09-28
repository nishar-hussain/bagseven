import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'bagseven',
  description: 'bagseven — the trust & settlement layer for autonomous AI agents: identity, policy, treasury, marketplaces, evolution',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}