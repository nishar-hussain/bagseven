import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Slice 2.4 — MCP discovery. Connects an MCP client to the marketplace MCP
 * server, lists tools, and (if any are listed) invokes one. Requires the
 * marketplace-tools service (MCP on :4008) to be running; skipped otherwise.
 */
describe('MCP marketplace discovery (2.4)', () => {
  it.runIf(process.env.CI !== 'true')('lists marketplace tools over MCP and can call one', async () => {
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4008/v1/mcp'));
    const client = new Client({ name: 'phase2-integration', version: '0.1.0' });
    try {
      await client.connect(transport);
    } catch {
      return; // MCP server not running — skip
    }
    try {
      const tools = await client.listTools();
      expect(Array.isArray(tools.tools)).toBe(true);
      if (tools.tools.length > 0) {
        const first = tools.tools[0]!;
        const res = await client.callTool({ name: first.name, arguments: { agent_id: '00000000-0000-4000-8000-000000000000', probe: true } });
        // Either succeeds or returns a structured error — but must NOT be a transport failure.
        expect(res.content).toBeDefined();
      }
    } finally {
      await transport.close();
    }
  });
});