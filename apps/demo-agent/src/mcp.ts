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
  await client.connect(transport);
  return { client, transport };
}

export async function closeMcp(connection: AgentMcp): Promise<void> {
  await connection.client.close();
  await connection.transport.close();
}
