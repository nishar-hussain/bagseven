import { readFileSync } from 'node:fs';
import { createPublicClient, http, erc20Abi } from 'viem';
import { sepolia } from 'viem/chains';
import { Client } from 'pg';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
async function main() {
  const pg = new Client({ connectionString: env.DATABASE_URL });
  await pg.connect();
  const rows = (await pg.query("select m.id, m.contract_address, a.id as root_id from mandates m join agents a on a.mandate_id = m.id and a.depth = 0 where m.contract_address is not null order by m.created_at desc limit 8")).rows;
  const c = createPublicClient({ chain: sepolia, transport: http(env.RPC_URL) });
  for (const r of rows) {
    const bal = await c.readContract({ address: r.contract_address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [r.contract_address as `0x${string}`] });
    if (Number(bal) > 0) console.log('FUNDED', r.root_id, 'vault', Number(bal) / 1e6, 'contract', r.contract_address);
  }
  await pg.end();
}
main().catch((e) => console.log('ERR', e.message));
