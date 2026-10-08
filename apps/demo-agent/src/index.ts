import { closeMcp, connectMcp } from './mcp.js';

const mcpUrl = process.env.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
const providerUrl = process.env.DEMO_AGENT_PROVIDER_URL ?? 'http://127.0.0.1:4007/weather';
const authToken = process.env.MCP_AUTH_TOKEN;

const connection = await connectMcp(mcpUrl, authToken);
try {
  const tools = await connection.client.listTools();
  console.log(JSON.stringify({ event: 'tools_discovered', tools: tools.tools.map((tool) => tool.name) }));

  const status = await connection.client.callTool({ name: 'bagseven_status', arguments: {} });
  console.log(JSON.stringify({ event: 'worker_status', result: status }, null, 2));

  const result = await connection.client.callTool({ name: 'bagseven_fetch', arguments: { url: providerUrl, reason: 'demo agent paid resource' } });
  console.log(JSON.stringify({ event: 'paid_resource_result', result }, null, 2));
} finally {
  await closeMcp(connection);
}
