import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = process.cwd();
const stateFile = `${root}/.demo/state.json`;
const children: ChildProcess[] = [];

function loadEnv(): void {
  if (!existsSync(`${root}/.env`)) return;
  for (const line of readFileSync(`${root}/.env`, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0 && process.env[line.slice(0, separator)] === undefined) process.env[line.slice(0, separator)] = line.slice(separator + 1);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function health(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function start(name: string, args: string[], extra: NodeJS.ProcessEnv = {}): ChildProcess {
  console.log(`[demo] starting ${name}`);
  const child = spawn('pnpm', args, { cwd: root, env: { ...process.env, ...extra }, stdio: 'inherit' });
  children.push(child);
  return child;
}

async function ensureService(name: string, url: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  if (await health(url)) {
    console.log(`[demo] ${name.padEnd(12)} ready (existing process)`);
    return;
  }
  start(name, args, env);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await health(url)) {
      console.log(`[demo] ${name.padEnd(12)} ready`);
      return;
    }
    await wait(500);
  }
  throw new Error(`${name} did not become ready at ${url}`);
}

function runSetup(): string {
  const output = execFileSync('pnpm', ['demo:setup'], { cwd: root, env: process.env, encoding: 'utf8' });
  process.stdout.write(output);
  const match = output.match(/"root_agent_id"\s*:\s*"([^"]+)"/);
  if (!match) throw new Error('demo setup did not return root_agent_id');
  return match[1];
}

async function main(): Promise<void> {
  loadEnv();
  console.log('\nBagseven Demo Mode\n==================\n');
  console.log('[demo] checking local dependencies');

  await ensureService('provider', `http://127.0.0.1:${process.env.DEMO_PROVIDER_PORT ?? 4007}/healthz`, ['--filter', '@bagseven/demo-provider', 'dev']);
  const providerHealth = await fetch(`http://127.0.0.1:${process.env.DEMO_PROVIDER_PORT ?? 4007}/healthz`).then((response) => response.json()) as { address: string };
  const providerRegistry = JSON.stringify({ '127.0.0.1': providerHealth.address });

  await ensureService('policy', `${process.env.POLICY_URL ?? 'http://127.0.0.1:4003'}/healthz`, ['--filter', '@bagseven/policy', 'dev']);
  await ensureService('daemon', `${process.env.DAEMON_URL ?? 'http://127.0.0.1:4001'}/healthz`, ['--filter', '@bagseven/daemon', 'dev'], { BAGSEVEN_PROVIDER_KEYS: providerRegistry });

  console.log('[demo] creating demo mandate');
  const worker = runSetup();
  const mcpPort = process.env.BAGSEVEN_MCP_PORT ?? '4009';
  await ensureService('MCP', `http://127.0.0.1:${mcpPort}/v1/mcp`, ['bagseven-mcp'], { BAGSEVEN_MCP_WORKER: worker, BAGSEVEN_MCP_PORT: mcpPort, BAGSEVEN_PROVIDER_KEYS: providerRegistry });

  const agentEnv = {
    BAGSEVEN_MCP_WORKER: worker,
    BAGSEVEN_MCP_URL: `http://127.0.0.1:${mcpPort}/v1/mcp`,
    DEMO_PROVIDER_RECIPIENT: providerHealth.address,
    DEMO_REFUSAL_AMOUNT: process.env.DEMO_REFUSAL_AMOUNT ?? '20.00',
  };
  mkdirSync(`${root}/.demo`, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ worker, provider: providerHealth.address }, null, 2));
  console.log(`[demo] worker       ${worker}`);
  console.log(`[demo] provider     ${providerHealth.address}`);
  console.log('[demo] running allowed and refused agent scenarios\n');
  execFileSync('pnpm', ['demo:agent'], { cwd: root, env: { ...process.env, ...agentEnv }, stdio: 'inherit' });
  console.log('\n[demo] complete: allowed payment and policy refusal were exercised');
}

function cleanup(): void {
  for (const child of children) child.kill('SIGTERM');
}

process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

main().catch((error) => {
  cleanup();
  console.error(`\n[demo] failed: ${(error as Error).message}`);
  console.error('[demo] start Docker/Postgres/Redis and set local test keys in .env, then rerun pnpm demo');
  process.exitCode = 1;
});
