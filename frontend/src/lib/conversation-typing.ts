export function isTypingInConversation(
  active: boolean | undefined,
  targets: readonly string[] | undefined,
  destination: string,
  connected = true,
) {
  return Boolean(connected && active && targets?.includes(destination));
}
