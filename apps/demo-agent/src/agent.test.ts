import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { runDemoAgent } from './agent.js';

describe('demo agent', () => {
  it('discovers tools, checks status, then fetches the paid resource', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const client = { listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'bagseven_status' }, { name: 'bagseven_fetch' }] }), callTool } as unknown as Client;
    await runDemoAgent({ client, providerUrl: 'http://provider/weather', logger: () => undefined });
    expect(callTool).toHaveBeenNthCalledWith(1, { name: 'bagseven_status', arguments: {} });
    expect(callTool).toHaveBeenNthCalledWith(2, { name: 'bagseven_fetch', arguments: { url: 'http://provider/weather', reason: 'Find and summarize the paid demo resource.' } });
  });
});
