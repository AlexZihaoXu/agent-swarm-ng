export function replyExcerpt(text: string) {
  const points = Array.from(text.replace(/\s+/gu, ' ').trim());
  return points.length > 160 ? `${points.slice(0, 160).join('')}…` : points.join('');
}
