import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Form Buddy GM — help with Greater Manchester council forms',
  description:
    'Plain-English help completing council forms, one question at a time. A proof of concept built for Build for Greater Manchester.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <header className="site-header">
          <div className="wrap header-inner">
            <a href="/" className="brand">
              <span className="brand-mark" aria-hidden="true" />
              <span>
                Form Buddy <strong>GM</strong>
              </span>
            </a>
            <p className="header-note">Proof of concept &middot; not a live council service</p>
          </div>
        </header>

        <main id="main" className="wrap">
          {children}
        </main>

        <footer className="site-footer">
          <div className="wrap">
            <p>
              Built for <strong>Build for Greater Manchester</strong>. This tool helps you
              prepare an application. It does not submit anything, and it cannot decide
              whether you qualify.
            </p>
            <p>
              Your answers stay in this browser tab so you do not lose them, and are
              cleared when you close it. They are never sent to us or stored on a server.
            </p>
            <p>Need to speak to a person? Contact your council directly.</p>
          </div>
        </footer>

        {/* Vercel Web Analytics: page views only, no cookies, no
            cross-site tracking. Custom events are a paid feature, so the
            funnel that actually matters is in /api/events instead. */}
        <Analytics />
      </body>
    </html>
  );
}
