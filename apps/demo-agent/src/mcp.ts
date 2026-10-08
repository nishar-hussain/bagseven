import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface AgentMcp {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

export async function connectMcp(url: string, authToken?: string): Promise<AgentMcp> {
  const retries = Number(process.env.BAGSEVEN_MCP_CONNECT_RETRIES ?? 15);
  const delayMs = Number(process.env.BAGSEVEN_MCP_CONNECT_DELAY_MS ?? 1000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: authToken ? { headers: { authorization: `Bearer ${authToken}` } } : undefined,
    });
    const client = new Client({ name: 'bagseven-demo-agent', version: '0.1.0' }, { capabilities: {} });
    try {
      await client.connect(transport);
      return { client, transport };
    } catch (error) {
      lastError = error;
      await transport.close().catch(() => undefined);
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to connect to Bagseven MCP at ${url} after ${retries} attempts. Start MCP with BAGSEVEN_MCP_WORKER=<worker-id> and BAGSEVEN_MCP_PORT=4009, then rerun the demo. ${message}`, { cause: lastError });
}

export async function closeMcp(connection: AgentMcp): Promise<void> {
  await connection.client.close();
  await connection.transport.close();
}
