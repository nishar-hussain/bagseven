import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface DemoAgentOptions {
  client: Client;
  providerUrl: string;
  task?: string;
  refusalAmount?: string;
  refusalRecipient?: string;
  logger?: (value: unknown) => void;
}

export async function runDemoAgent({ client, providerUrl, task = 'Find and summarize the paid demo resource.', refusalAmount, refusalRecipient, logger = console.log }: DemoAgentOptions): Promise<unknown> {
  const tools = await client.listTools();
  logger({ event: 'tools_discovered', tools: tools.tools.map((tool) => tool.name) });

  const status = await client.callTool({ name: 'bagseven_status', arguments: {} });
  logger({ event: 'worker_status', result: status });
  logger({ event: 'task_started', task });

  const result = await client.callTool({ name: 'bagseven_fetch', arguments: { url: providerUrl, reason: task } });
  logger({ event: 'paid_resource_result', result });

  if (refusalAmount && refusalRecipient) {
    logger({ event: 'refusal_started', amount: refusalAmount, recipient: refusalRecipient });
    const refusal = await client.callTool({ name: 'bagseven_fetch', arguments: { amount: refusalAmount, recipient: refusalRecipient, reason: 'Demo policy refusal scenario' } });
    logger({ event: 'refusal_result', result: refusal });
    return { success: result, refusal };
  }

  return result;
}
