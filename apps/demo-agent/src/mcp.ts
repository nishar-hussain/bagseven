import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface AgentMcp {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

export async function connectMcp(url: string, authToken?: string): Promise<AgentMcp> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: authToken ? { headers: { authorization: `Bearer ${authToken}` } } : undefined,
  });
  const client = new Client({ name: 'bagseven-demo-agent', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`Unable to connect to Bagseven MCP at ${url}. Start MCP with BAGSEVEN_MCP_WORKER=<worker-id> and BAGSEVEN_MCP_PORT=4009. ${(error as Error).message}`, { cause: error });
  }
  return { client, transport };
}

export async function closeMcp(connection: AgentMcp): Promise<void> {
  await connection.client.close();
  await connection.transport.close();
}
