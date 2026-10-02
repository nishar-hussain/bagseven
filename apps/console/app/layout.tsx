import type { Metadata } from 'next';
import { ThemeProvider } from '../components/theme-provider';
import { RainbowProvider } from '../components/rainbow-provider';
import { Toaster } from '../components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bagseven',
  description: 'Bagseven — bounded spending control for autonomous AI agents. Connect your wallet, sign a mandate once, and every agent spend is enforced on-chain.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-[#f5f6f8] text-[#111827]">
        <RainbowProvider>
          <ThemeProvider>
            {children}
            <Toaster />
          </ThemeProvider>
        </RainbowProvider>
      </body>
    </html>
  );
}