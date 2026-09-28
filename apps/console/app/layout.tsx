import type { Metadata } from 'next';
import { ThemeProvider } from '../components/theme-provider';
import { Toaster } from '../components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'bagseven',
  description: 'bagseven — infrastructure for autonomous AI agents: identity, treasury, policy, marketplaces',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}