import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  createPublicClient,
  erc20Abi,
  http,
  parseUnits,
  decodeEventLog,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { ServiceDeps } from '@agentos/server';

/**
 * A dev-only x402 provider used to test the marketplace payment flow (slice 2.2).
 *
 * - POST without an X-Payment header → 402 + an x402 challenge (price, token,
 *   chain, payTo = the provider's own address, nonce, expiry).
 * - POST with an X-Payment: <tx> header → verifies the tx on-chain (a USDC
 *   Transfer to this provider's address) and returns a 200 result.
 *
 * The provider's payout address is printed at boot — register it as the tool
 * provider's payout_wallet_address.
 */

const DEMO_KEY = process.env.DEMO_PROVIDER_KEY ?? '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
const DEMO_PRICE = process.env.DEMO_PROVIDER_PRICE ?? '0.10';
const DEMO_CHAIN = process.env.DEMO_PROVIDER_CHAIN ?? 'sepolia';
const RPC = process.env.SEPOLIA_RPC_URL ?? 'http://localhost:8545';
const USDC = (process.env.SEPOLIA_USDC ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Address;

export function buildDemoProviderRoutes(app: FastifyInstance, _deps: ServiceDeps): void {
  const account = privateKeyToAccount(DEMO_KEY as Hex);
  const payTo = account.address;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });

  app.log.warn(`[demo-provider] payout address ${payTo} · price ${DEMO_PRICE} ${DEMO_CHAIN} · RPC ${RPC}`);

  app.get('/v1/health', async () => ({ ok: true, payTo, price: DEMO_PRICE, chain: DEMO_CHAIN }));

  app.post('/v1/exec', async (req, reply) => {
    const paymentProof = req.headers['x-payment'];

    if (typeof paymentProof !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(paymentProof)) {
      // No payment proof → 402 challenge. The body is irrelevant for the challenge.
      return reply.code(402).send({
        challenge: {
          amount: DEMO_PRICE,
          token: 'USDC',
          chain: DEMO_CHAIN,
          payTo,
          nonce: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
    }

    const body = z.record(z.string(), z.unknown()).parse(req.body ?? {});

    // Verify the payment on-chain: a confirmed USDC Transfer to this provider.
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: paymentProof as Hex });
    } catch {
      return reply.code(400).send({ error: { code: 'PAYMENT_UNVERIFIED', message: 'transaction not found' } });
    }
    if (receipt.status !== 'success') {
      return reply.code(400).send({ error: { code: 'PAYMENT_UNVERIFIED', message: 'transaction reverted' } });
    }

    const expectedUnits = parseUnits(DEMO_PRICE, 6);
    let paid = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'Transfer' && (decoded.args.to as string).toLowerCase() === payTo.toLowerCase() && decoded.args.value >= expectedUnits) {
          paid = true;
          break;
        }
      } catch {
        /* not a transfer log */
      }
    }

    if (!paid) {
      return reply.code(400).send({ error: { code: 'PAYMENT_UNVERIFIED', message: 'no matching USDC transfer to provider' } });
    }

    return {
      result: {
        ok: true,
        provider: 'demo-provider',
        echo: body,
        settled_at: new Date().toISOString(),
      },
    };
  });
}