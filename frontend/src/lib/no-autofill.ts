/**
 * For fields that are not the dashboard's own sign-in: password managers (Chrome, 1Password, LastPass, Bitwarden,
 * Dashlane) must not fill saved logins into them. Browsers ignore autocomplete="off" for that, so each manager's own
 * opt-out is set too.
 */
export const noAutofill = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/**
 * A secret that is not a login (an API key, a bot token): a text field masked by CSS while hidden, because a real
 * password field makes password managers treat the form as a sign-in and fill it (and the field before it).
 */
export function secretField(hidden: boolean) {
  return { type: 'text', spellCheck: false, ...noAutofill, 'data-masked': hidden ? 'true' : undefined } as const;
}
