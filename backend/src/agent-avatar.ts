import { Type, type Static } from '@sinclair/typebox';
export const AvatarSchema = Type.Object(
  {
    shape: Type.Union(
      ['pebble', 'squircle', 'gumdrop', 'triangle', 'bean', 'pear', 'capsule', 'diamond'].map(value =>
        Type.Literal(value),
      ),
    ),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$' }),
    eyeStyle: Type.Optional(Type.Union([Type.Literal('pill'), Type.Literal('round')])),
    seed: Type.Integer({ minimum: 0, maximum: 2147483647 }),
    // Later traits are optional; leaving one out draws the original look, so older avatars never change.
    stretch: Type.Optional(Type.Number({ minimum: -1, maximum: 1 })),
    taper: Type.Optional(Type.Number({ minimum: -1, maximum: 1 })),
    wobble: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    eyeSize: Type.Optional(Type.Number({ minimum: 0.75, maximum: 1.35 })),
    eyeGap: Type.Optional(Type.Number({ minimum: -1, maximum: 1 })),
    mouth: Type.Optional(Type.Union(['none', 'smile', 'flat', 'open', 'cat'].map(value => Type.Literal(value)))),
    marking: Type.Optional(
      Type.Union(['none', 'cheeks', 'spots', 'belly', 'stripe'].map(value => Type.Literal(value))),
    ),
    accent: Type.Optional(Type.String({ minLength: 7, maxLength: 7, pattern: '^#[0-9a-fA-F]{6}$' })),
    accessory: Type.Optional(
      Type.Union(['none', 'antenna', 'sprout', 'bow', 'halo', 'glasses'].map(value => Type.Literal(value))),
    ),
  },
  { additionalProperties: false },
);
export type AgentAvatar = Static<typeof AvatarSchema>;
export const encodeAvatar = (avatar: AgentAvatar) =>
  JSON.stringify({
    ...avatar,
    color: avatar.color.toLowerCase(),
    ...(avatar.accent ? { accent: avatar.accent.toLowerCase() } : {}),
  });
