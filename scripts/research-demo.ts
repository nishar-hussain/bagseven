import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

for (const line of (() => { try { return readFileSync('.env', 'utf8').split('\n'); } catch { return []; } })()) {
  const index = line.indexOf('=');
  if (index > 0 && process.env[line.slice(0, index)] === undefined) process.env[line.slice(0, index)] = line.slice(index + 1);
}

const demoPort = process.env.RESEARCH_DEMO_PORT ?? '4020';
const mcpUrl = process.env.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
const children: ChildProcess[] = [];

async function ready(url: string): Promise<boolean> { try { return (await fetch(url, process.env.MCP_AUTH_TOKEN ? { headers: { authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } } : undefined)).ok; } catch { return false; } }
async function main(): Promise<void> {
  if (!(await ready(mcpUrl))) throw new Error(`MCP is not reachable at ${mcpUrl}. Start it with BAGSEVEN_MCP_WORKER=<worker-id> and BAGSEVEN_MCP_PORT=4009 first.`);
  const provider = spawn('pnpm', ['research-provider'], { stdio: 'inherit', env: process.env });
  const demo = spawn('pnpm', ['research-demo'], { stdio: 'inherit', env: process.env });
  children.push(provider, demo);
  console.log(`\nBagseven Research Buyer: http://127.0.0.1:${demoPort}`);
  console.log('Provider and research UI are running. Press Ctrl-C to stop them.');
}
function stop(): void { for (const child of children) child.kill('SIGTERM'); }
process.once('SIGINT', () => { stop(); process.exit(130); });
process.once('SIGTERM', () => { stop(); process.exit(143); });
main().catch((error) => { console.error(`[research-demo] ${(error as Error).message}`); process.exitCode = 1; });
