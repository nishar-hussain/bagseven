import type { Metadata } from 'next';
import { ThemeProvider } from '../components/theme-provider';
import { Toaster } from '../components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cordon console',
  description: 'Cordon console — policy, mandates, and guardrails for autonomous AI agents',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-[#f5f6f8] text-[#111827]">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}