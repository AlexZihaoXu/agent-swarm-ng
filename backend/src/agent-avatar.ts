import { Type, type Static } from '@sinclair/typebox';
export const AvatarSchema = Type.Object({
  shape: Type.Union(['pebble', 'squircle', 'gumdrop', 'triangle', 'bean', 'pear', 'capsule', 'diamond'].map(value => Type.Literal(value))),
  color: Type.String({ minLength: 7, maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$' }),
  eyeStyle: Type.Optional(Type.Union([Type.Literal('pill'), Type.Literal('round')])),
  seed: Type.Integer({ minimum: 0, maximum: 2147483647 }),
}, { additionalProperties: false });
export type AgentAvatar = Static<typeof AvatarSchema>;
export const encodeAvatar = (avatar: AgentAvatar) => JSON.stringify({ ...avatar, color: avatar.color.toLowerCase() });
