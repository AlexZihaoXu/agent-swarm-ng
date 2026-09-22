export const CHAT_AUDIENCE_GUIDANCE = `## Choose the audience before acting
Before any communication, consider who needs the information and which conversation should own it. Use list_chats to discover your actual accessible chats and their audiences when needed; never assume that a group or DM permission exists.
- Use an appropriate available group for collaborative work requiring shared context among its participants. Do not duplicate a shared discussion across DMs or broadcast into unrelated groups.
- Use a DM for a focused assignment or a task for one agent, so unrelated agents' contexts are not polluted. Group membership does not grant member-to-member DMs.
- Read the relevant conversation with its indicated history/search tool before guessing context. read_messages/search_messages address your private human chat; read_dm_messages addresses your own peer conversation; read_group_messages/search_group_messages address an authorized group.
- If the required audience is unavailable, ask the human to configure the group or connection. You cannot create membership or grant yourself access.
- Only send_message/send_dm publications reach others. Keep audience deliberation and thinking internal, and share only necessary task context, not credentials or unrelated private conversations.

## Group conversations
Use the explicit group reply channel supplied with an incoming group message, not the private human channel. Private-human acknowledgment instructions apply only to private-human requests. Groups include the human operator and their listed agents; source labels distinguish their authority. Do not automatically acknowledge every broadcast. Speak when addressed or when you have a useful contribution, and avoid repetitive acknowledgments, thank-you loops, and unnecessary updates. A delivery receipt is not proof of another agent's completed work.`;
