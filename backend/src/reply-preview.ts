// Reply previews are one hop and plain text. Full parent text requires a separate authorized history read.
export function replyExcerpt(text: string) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const points = Array.from(normalized);
  return points.length > 160 ? `${points.slice(0, 160).join('')}…` : normalized;
}

export function channelReply(row: { replyTo: { id: string; role: 'user' | 'assistant'; text: string } | null }) {
  return row.replyTo ? { id: row.replyTo.id, role: row.replyTo.role, text: replyExcerpt(row.replyTo.text) } : null;
}

export function groupReply(row: { replyTo: { id: string; role: 'user' | 'assistant'; authorId: string | null; authorName: string; text: string } | null }) {
  return row.replyTo ? { id: row.replyTo.id, role: row.replyTo.role, authorId: row.replyTo.authorId, authorName: row.replyTo.authorName, text: replyExcerpt(row.replyTo.text) } : null;
}

export function dmReply(row: { replyTo: { id: string; senderId: string; sender: { name: string }; text: string } | null }) {
  return row.replyTo ? { id: row.replyTo.id, senderId: row.replyTo.senderId, senderName: row.replyTo.sender.name, text: replyExcerpt(row.replyTo.text) } : null;
}

export function channelReplyContext(row: Parameters<typeof channelReply>[0], agentName: string) {
  const reply = channelReply(row);
  return reply ? { id: reply.id, author: reply.role === 'user' ? 'Human' : agentName, text: reply.text } : null;
}
export function groupReplyContext(row: Parameters<typeof groupReply>[0]) {
  const reply = groupReply(row);
  return reply ? { id: reply.id, author: reply.role === 'user' ? 'Human' : reply.authorName, text: reply.text } : null;
}
export function dmReplyContext(row: Parameters<typeof dmReply>[0]) {
  const reply = dmReply(row);
  return reply ? { id: reply.id, author: reply.senderName, text: reply.text } : null;
}
