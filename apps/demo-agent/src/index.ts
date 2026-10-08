import { closeMcp, connectMcp } from './mcp.js';
import { runDemoAgent } from './agent.js';

const mcpUrl = process.env.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
const providerUrl = process.env.DEMO_AGENT_PROVIDER_URL ?? 'http://127.0.0.1:4007/weather';
const authToken = process.env.MCP_AUTH_TOKEN;
const task = process.env.DEMO_AGENT_TASK ?? 'Find and summarize the paid demo resource.';
const refusalAmount = process.env.DEMO_REFUSAL_AMOUNT;
const refusalRecipient = process.env.DEMO_PROVIDER_RECIPIENT;

const connection = await connectMcp(mcpUrl, authToken);
try {
  await runDemoAgent({ client: connection.client, providerUrl, task, refusalAmount, refusalRecipient, logger: (event) => console.log(JSON.stringify(event, null, 2)) });
} finally {
  await closeMcp(connection);
}
