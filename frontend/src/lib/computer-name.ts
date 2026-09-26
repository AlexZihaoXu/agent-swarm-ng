// Default names for new computers: `Workspace-NG` plus four random uppercase
// letters, chosen so the suggestion does not repeat a name already in use.
// Compare case-insensitively because that is how the backend rejects duplicates.
// getRandomValues is available on HTTP origins where crypto.randomUUID is not.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SUFFIX_LENGTH = 4;
const MAX_ATTEMPTS = 200;

function randomSuffix() {
  // Rejection sampling keeps all 26 letters equally likely (256 is not a multiple of 26).
  const letters: string[] = [];
  while (letters.length < SUFFIX_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH))) {
      if (byte < 234) letters.push(LETTERS[byte % LETTERS.length]);
      if (letters.length === SUFFIX_LENGTH) break;
    }
  }
  return letters.join('');
}

/** Returns an unused `Workspace-NGXXXX` name, or null when every candidate collides. */
export function generateComputerName(taken: Iterable<string> = []): string | null {
  const used = new Set<string>();
  for (const name of taken) {
    if (typeof name === 'string') used.add(name.toLocaleLowerCase('en-US'));
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = `Workspace-NG${randomSuffix()}`;
    if (!used.has(candidate.toLocaleLowerCase('en-US'))) return candidate;
  }
  return null;
}
