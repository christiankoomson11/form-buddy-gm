/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Security headers. A public-sector tool gets asked about these, so they are
  // set explicitly rather than left to defaults.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            /*
             * microphone=(self) allows getUserMedia on OUR origin and
             * nowhere else — not in an embedded iframe, not for a third
             * party script.
             *
             * This must not be `microphone=()`. An empty allowlist means
             * "no origin may use the microphone", including this one, and
             * the browser then refuses getUserMedia WITHOUT showing a
             * permission prompt at all. That failure looks exactly like a
             * broken app: the button does nothing and no dialog appears.
             *
             * Camera and geolocation stay fully disabled — this tool has
             * no business asking for either, and saying so explicitly is
             * worth a line in an information governance conversation.
             */
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
