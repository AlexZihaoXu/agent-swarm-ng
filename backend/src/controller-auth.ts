/** Shared secret between the backend and the internal computer controller. Empty keeps the previous unauthenticated behavior. */
export function controllerHeaders(token = process.env.COMPUTER_CONTROLLER_TOKEN): Record<string, string> {
  return token ? { 'x-controller-token': token } : {};
}
