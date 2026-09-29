import { sql, eq } from 'drizzle-orm';
import { agents, mandates } from '@agentos/db';
import type { Database } from '@agentos/db';
import { add, div, gt, gte, lt, mul, sub } from '@agentos/money';

export type MandateRow = typeof mandates.$inferSelect;

export type Bound = 'window' | 'lifetime' | 'per_purchase' | 'per_seller' | 'depth' | 'vault';

export interface EvaluateInput {
  amount: string;
  seller: string | null;
  depth: number;
  now: number;
  vaultAvailable: string;
  mandate: MandateRow;
}

export interface EvaluateResult {
  ok: boolean;
  bound?: Bound;
  reason?: string;
  currentWindowSpent: string;
  remainingWindow: string;
  remainingLifetime: string;
  remainingVault: string;
  canDraw: string;
}

const ZERO = '0';

function sellerLimit(mandate: MandateRow): string {
  return mul(mandate.budgetPerWindow, div(String(mandate.perSellerLimitBps), '10000'));
}

function sellerSpentOf(mandate: MandateRow, seller: string | null): string {
  if (!seller) return ZERO;
  return ((mandate.sellerSpent as Record<string, string>)[seller] ?? ZERO) as string;
}

/** Effective window spend, accounting for window rollover. */
export function effectiveWindowSpent(mandate: MandateRow, now: number): { spent: string; reset: boolean } {
  const windowMs = Number(mandate.windowSeconds) * 1000;
  const elapsed = now - new Date(mandate.windowOpenedAt).getTime();
  const reset = elapsed >= windowMs;
  return { spent: reset ? ZERO : mandate.windowSpent, reset };
}

function minOf(...vals: string[]): string {
  let min = vals[0] ?? ZERO;
  for (const v of vals) if (lt(v, min)) min = v;
  return min;
}

/**
 * Pure bounds evaluation (the off-chain mirror of BagMandate.check). A purchase
 * is refused if it violates ANY bound: window budget, lifetime cap, per-purchase
 * limit, per-seller limit, agent depth, or available vault balance.
 */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const { mandate, amount, seller, depth, now, vaultAvailable } = input;

  const { spent: currentWindowSpent } = effectiveWindowSpent(mandate, now);
  const remainingWindow = sub(mandate.budgetPerWindow, currentWindowSpent);
  const remainingLifetime = sub(mandate.lifetimeCap, mandate.lifetimeSpent);
  const remainingVault = vaultAvailable;

  const refuse = (bound: Bound, reason: string): EvaluateResult => ({
    ok: false,
    bound,
    reason,
    currentWindowSpent,
    remainingWindow,
    remainingLifetime,
    remainingVault,
    canDraw: ZERO,
  });

  if (gte(amount, mandate.perPurchaseLimit)) {
    return refuse('per_purchase', `amount ${amount} is not below the per-purchase limit ${mandate.perPurchaseLimit}`);
  }
  if (depth > mandate.maxDepth) {
    return refuse('depth', `agent depth ${depth} exceeds the mandate max depth ${mandate.maxDepth}`);
  }
  if (gte(add(currentWindowSpent, amount), mandate.budgetPerWindow)) {
    return refuse('window', `window spend ${add(currentWindowSpent, amount)} is not below budget ${mandate.budgetPerWindow}`);
  }
  if (gte(add(mandate.lifetimeSpent, amount), mandate.lifetimeCap)) {
    return refuse('lifetime', `lifetime spend ${add(mandate.lifetimeSpent, amount)} is not below cap ${mandate.lifetimeCap}`);
  }
  if (seller && gt(add(sellerSpentOf(mandate, seller), amount), sellerLimit(mandate))) {
    return refuse('per_seller', `seller ${seller} would exceed its ${sellerLimit(mandate)} share`);
  }
  if (gt(amount, remainingVault)) {
    return refuse('vault', `vault available ${remainingVault} is less than the purchase ${amount}`);
  }

  return {
    ok: true,
    currentWindowSpent,
    remainingWindow,
    remainingLifetime,
    remainingVault,
    canDraw: minOf(remainingWindow, remainingLifetime, remainingVault),
  };
}

export interface ApplyInput {
  amount: string;
  seller: string | null;
  now: number;
  vaultAvailable: string;
}

export interface ApplyResult {
  ok: boolean;
  bound?: Bound;
  reason?: string;
  windowSpent: string;
  lifetimeSpent: string;
  remainingWindow: string;
  remainingLifetime: string;
}

function refusalResult(row: MandateRow, bound: Bound, reason: string): ApplyResult {
  return {
    ok: false,
    bound,
    reason,
    windowSpent: row.windowSpent,
    lifetimeSpent: row.lifetimeSpent,
    remainingWindow: sub(row.budgetPerWindow, row.windowSpent),
    remainingLifetime: sub(row.lifetimeCap, row.lifetimeSpent),
  };
}

/**
 * Atomic commit-side counter increment. Locks the mandate row, re-checks every
 * bound against the CURRENT state (mirroring BagMandate.attemptAndCommit), and
 * only then increments window/lifetime/seller counters. Returns a refusal result
 * if a bound is now violated, without changing anything.
 */
export async function applySpend(db: Database, mandateId: string, input: ApplyInput): Promise<ApplyResult> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select * from mandates where id = ${mandateId} for update`);
    const rawRow = (rows as unknown as { rows: Record<string, unknown>[] }).rows[0];
    const row = rawRow ? mapMandateRow(rawRow) : undefined;
    if (!row) throw new Error(`mandate ${mandateId} not found`);
    const mandate = { ...row, sellerSpent: (row.sellerSpent as Record<string, string>) ?? {} } as MandateRow;

    const { spent: currentWindowSpent, reset } = effectiveWindowSpent(mandate, input.now);

    if (gte(add(currentWindowSpent, input.amount), mandate.budgetPerWindow)) {
      return refusalResult(mandate, 'window', 'window budget would be exceeded');
    }
    if (gte(add(mandate.lifetimeSpent, input.amount), mandate.lifetimeCap)) {
      return refusalResult(mandate, 'lifetime', 'lifetime cap would be exceeded');
    }
    if (input.seller && gt(add(sellerSpentOf(mandate, input.seller), input.amount), sellerLimit(mandate))) {
      return refusalResult(mandate, 'per_seller', 'per-seller limit would be exceeded');
    }
    if (gt(input.amount, input.vaultAvailable)) {
      return refusalResult(mandate, 'vault', 'vault has insufficient available funds');
    }

    const newWindowSpent = reset ? input.amount : add(currentWindowSpent, input.amount);
    const newLifetime = add(mandate.lifetimeSpent, input.amount);
    const sellerKey = input.seller ?? '__none__';
    const newSellerSpent = { ...(mandate.sellerSpent as Record<string, string>) };
    newSellerSpent[sellerKey] = add(newSellerSpent[sellerKey] ?? ZERO, input.amount);

    await tx
      .update(mandates)
      .set({
        windowSpent: newWindowSpent,
        lifetimeSpent: newLifetime,
        sellerSpent: newSellerSpent,
        windowOpenedAt: reset ? new Date(input.now) : mandate.windowOpenedAt,
      })
      .where(eq(mandates.id, mandateId));

    return {
      ok: true,
      windowSpent: newWindowSpent,
      lifetimeSpent: newLifetime,
      remainingWindow: sub(mandate.budgetPerWindow, newWindowSpent),
      remainingLifetime: sub(mandate.lifetimeCap, newLifetime),
    };
  });
}

/** Reverse counters when a settled spend is reversed (never goes below zero). */
export async function reverseSpend(db: Database, mandateId: string, amount: string, seller: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select * from mandates where id = ${mandateId} for update`);
    const rawRow = (rows as unknown as { rows: Record<string, unknown>[] }).rows[0];
    const row = rawRow ? mapMandateRow(rawRow) : undefined;
    if (!row) return;
    const sellerKey = seller ?? '__none__';
    const sellerSpent = (row.sellerSpent as Record<string, string>) ?? {};
    const sellerVal = sellerSpent[sellerKey] ?? ZERO;
    const newSeller = sellerVal === ZERO ? ZERO : sub(sellerVal, amount);
    const lifetime = row.lifetimeSpent === ZERO ? ZERO : sub(row.lifetimeSpent, amount);
    const windowSpent = row.windowSpent === ZERO ? ZERO : sub(row.windowSpent, amount);
    await tx
      .update(mandates)
      .set({ windowSpent, lifetimeSpent: lifetime, sellerSpent: { ...sellerSpent, [sellerKey]: newSeller } })
      .where(eq(mandates.id, mandateId));
  });
}

/** Canonical signed payload for a mandate. The operator signs this once. */
export function canonicalMandate(input: {
  agent_id: string;
  operator_address: string;
  budget_per_window: string;
  window_seconds: number;
  lifetime_cap: string;
  per_purchase_limit: string;
  per_seller_limit_bps: number;
  max_depth: number;
  chain: string;
}): string {
  return [
    'bagseven-mandate-v1',
    input.agent_id,
    input.operator_address,
    input.budget_per_window,
    input.window_seconds,
    input.lifetime_cap,
    input.per_purchase_limit,
    input.per_seller_limit_bps,
    input.max_depth,
    input.chain,
  ].join('|');
}

/** Depth of an agent within its mandate tree (0 = root), plus the root id. */
export async function depthOfAgent(db: Database, agentId: string): Promise<{ depth: number; rootAgentId: string }> {
  let depth = 0;
  let rootAgentId = agentId;
  let cur = (await db.query.agents.findFirst({ where: eq(agents.id, agentId) }))?.parentAgentId ?? null;
  while (cur) {
    depth += 1;
    rootAgentId = cur;
    const parent = await db.query.agents.findFirst({ where: eq(agents.id, cur) });
    cur = parent?.parentAgentId ?? null;
  }
  return { depth, rootAgentId };
}

/** Map a raw `select *` row (snake_case columns) to the drizzle camelCase shape. */
export function mapMandateRow(raw: Record<string, unknown>): MandateRow {
  return {
    id: String(raw.id),
    agentId: String(raw.agent_id),
    operatorAddress: String(raw.operator_address),
    budgetPerWindow: String(raw.budget_per_window),
    windowSeconds: Number(raw.window_seconds),
    lifetimeCap: String(raw.lifetime_cap),
    perPurchaseLimit: String(raw.per_purchase_limit),
    perSellerLimitBps: Number(raw.per_seller_limit_bps),
    maxDepth: Number(raw.max_depth),
    chain: String(raw.chain),
    contractAddress: raw.contract_address ? String(raw.contract_address) : null,
    signature: String(raw.signature),
    status: raw.status as MandateRow['status'],
    supersededAt: raw.superseded_at ? new Date(raw.superseded_at as string) : null,
    windowOpenedAt: new Date(raw.window_opened_at as string),
    windowSpent: String(raw.window_spent ?? '0'),
    lifetimeSpent: String(raw.lifetime_spent ?? '0'),
    sellerSpent: (raw.seller_spent as Record<string, string>) ?? {},
    createdBy: String(raw.created_by),
    createdAt: new Date(raw.created_at as string),
  };
}