/**
 * How a human message's writer is shown (docs/users.md#in-chats): "You" for your own (and older messages, which
 * recorded no writer), otherwise the person's name (admin writing in a user's organization, as the user sees it).
 */
export const humanName = (writer: string | null | undefined, me: string) =>
  !writer || writer === 'You' || writer === me ? 'You' : writer;
