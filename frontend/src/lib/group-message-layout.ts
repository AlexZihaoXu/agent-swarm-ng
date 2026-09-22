type Message = { groupId: string; role: string; authorId: string | null; timestamp: number };
export function continuesGroup(previous: Message | undefined, message: Message) {
  const gap = previous ? message.timestamp - previous.timestamp : -1;
  return Boolean(previous && previous.groupId === message.groupId && previous.role === message.role && previous.authorId === message.authorId && gap >= 0 && gap <= 5 * 60 * 1000 && new Date(previous.timestamp).toDateString() === new Date(message.timestamp).toDateString());
}
