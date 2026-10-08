import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface DemoAgentOptions {
  client: Client;
  providerUrl: string;
  task?: string;
  logger?: (value: unknown) => void;
}

export async function runDemoAgent({ client, providerUrl, task = 'Find and summarize the paid demo resource.', logger = console.log }: DemoAgentOptions): Promise<unknown> {
  const tools = await client.listTools();
  logger({ event: 'tools_discovered', tools: tools.tools.map((tool) => tool.name) });

  const status = await client.callTool({ name: 'bagseven_status', arguments: {} });
  logger({ event: 'worker_status', result: status });
  logger({ event: 'task_started', task });

  const result = await client.callTool({ name: 'bagseven_fetch', arguments: { url: providerUrl, reason: task } });
  logger({ event: 'paid_resource_result', result });
  return result;
}
