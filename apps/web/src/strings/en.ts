// All user-facing English strings live here so translation can be added later (NFR-009).
export const en = {
  appName: 'GovServe',
  tagline: 'Banadir Regional Administration online services',
  skipToContent: 'Skip to main content',
  nav: { home: 'Home', citizen: 'My applications', officer: 'Work queue', admin: 'Administration' },
  home: {
    heading: 'Apply for official documents online',
    intro:
      'Apply for proof of address, police clearance or a birth certificate, pay, and download a verifiable certificate.',
    services: ['Proof of address', 'Police clearance', 'Birth certificate'],
  },
  status: {
    label: 'Service status',
    checking: 'Checking service status…',
    ok: 'All systems operational',
    degraded: 'Some services are unavailable. Please try again later.',
    unreachable: 'Cannot reach GovServe. Check your connection and try again.',
  },
  placeholder: { comingSoon: 'This area is coming soon.' },
  notFound: { heading: 'Page not found', back: 'Go to the home page' },
} as const;
