import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/ibm-plex-sans';
import './globals.css';

/*
 * Two families, clearly distinct, both self-hosted.
 *
 * Bricolage Grotesque carries the headings: tight, slightly odd
 * proportions, confident without being corporate. It stops the page
 * looking like every other public-service tool set in Inter.
 *
 * IBM Plex Sans does the work. It was drawn for interfaces and stays
 * legible at small sizes and in poor light, which matters when someone is
 * filling this in on an old phone in a library.
 *
 * Served from our own domain rather than Google Fonts on purpose. A
 * resident loading this should not also be making a request to Google,
 * and self-hosting means no third party learns who is reading a council
 * form about their housing. It also removes a dependency that could fail
 * at build time.
 */

export const metadata: Metadata = {
  title: 'Form Buddy GM — say it, and we write it down',
  description:
    'Fill in a Greater Manchester council form by speaking, in any language. A proof of concept built for Build for Greater Manchester.',
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
              {/* A sound wave: the shape a voice makes. */}
              <span className="brand-mark" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Form Buddy GM
            </a>
            <p className="header-note">Proof of concept, not a live council service</p>
          </div>
        </header>

        <main id="main" className="wrap">
          {children}
        </main>

        <footer className="site-footer">
          <div className="wrap">
            <p>
              Built for Build for Greater Manchester. This tool helps you prepare an
              application. It does not submit anything, and it cannot decide whether
              you qualify.
            </p>
            <p>
              Your answers stay in this browser tab so you do not lose them, and are
              cleared when you close it. They are never stored on a server.
            </p>
            <p>Need to speak to a person? Contact your council directly.</p>
          </div>
        </footer>

        <Analytics />
      </body>
    </html>
  );
}
