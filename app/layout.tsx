import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Manager',
  description: 'Simple job scheduling, notes, todos and estimator',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
