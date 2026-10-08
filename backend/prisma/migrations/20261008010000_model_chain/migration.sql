-- Fallback models: #1 options and ranked fallbacks (model-chain.ts).
ALTER TABLE "Agent" ADD COLUMN "modelChain" TEXT NOT NULL DEFAULT '{}';
