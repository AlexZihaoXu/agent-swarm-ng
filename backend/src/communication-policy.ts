import type { Prisma } from './generated/prisma/client';

/** Agent roots die with their agent; human group roots die with their group. */
export const liveChainWhere = {
  cancelled: false,
  OR: [{ rootAgentId: { not: null } }, { origin: 'human', rootGroupId: { not: null } }],
} satisfies Prisma.DmChainWhereInput;

export function isLiveChain(
  chain: { cancelled: boolean; rootAgentId: string | null; origin: string; rootGroupId: string | null } | null,
) {
  return Boolean(
    chain &&
    !chain.cancelled &&
    (chain.rootAgentId !== null || (chain.origin === 'human' && chain.rootGroupId !== null)),
  );
}
