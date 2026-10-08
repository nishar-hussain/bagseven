import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: process.env.MCP_AUTH_TOKEN ? { headers: { authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } } : undefined });
const client = new Client({ name: 'bagseven-demo-check', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);
try {
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expected = ['bagseven_fetch', 'bagseven_spawn', 'bagseven_status'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`unexpected MCP tools: ${names.join(', ')}`);
  const statusTool = tools.tools.find((tool) => tool.name === 'bagseven_status');
  if (Object.keys(statusTool?.inputSchema?.properties ?? {}).length !== 0) throw new Error('MCP status tool is not worker-bound');
  const status = await client.callTool({ name: 'bagseven_status', arguments: {} });
  if (status.isError) throw new Error(`status tool failed: ${JSON.stringify(status)}`);
  console.log(JSON.stringify({ ok: true, tools: names, worker_bound: true }));
} finally {
  await client.close();
  await transport.close();
}
