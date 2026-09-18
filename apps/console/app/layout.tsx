import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentOS Console',
  description: 'Developer console for AgentOS — identity, treasury, policy',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}