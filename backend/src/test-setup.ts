import { detectedLimits } from './endpoint-detection';

// Mock model servers answer chat completions only: a turn's GET /models lookup (endpoint-detection.ts) stays off unless
// a test turns it on by replacing the fetcher.
detectedLimits.fetcher = Object.assign(
  async () => {
    throw new Error('No endpoint lookups in tests.');
  },
  { preconnect: fetch.preconnect },
);
