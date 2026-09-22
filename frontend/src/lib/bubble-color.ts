/** Preserve the sender's hue without turning a whole message into a bright avatar swatch. */
export function agentBubbleStyle(color: string) {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, var(--background))`,
    color: 'var(--foreground)',
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 28%, transparent)`,
  };
}
