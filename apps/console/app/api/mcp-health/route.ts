import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const expectedWorker = new URL(request.url).searchParams.get('worker');
  const target = process.env.BAGSEVEN_MCP_HEALTH_URL ?? 'http://127.0.0.1:4009/v1/mcp';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(target, { cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => undefined) as { ok?: boolean; worker?: string; error?: string } | undefined;
    if (!response.ok) {
      return NextResponse.json({ error: body?.error ?? `MCP health returned HTTP ${response.status}` }, { status: 502 });
    }
    if (!body?.ok || !body.worker) {
      return NextResponse.json({ error: 'MCP returned an invalid health response' }, { status: 502 });
    }
    if (expectedWorker && body.worker !== expectedWorker) {
      return NextResponse.json({ error: 'MCP is running, but it is bound to a different worker', worker: body.worker }, { status: 409 });
    }
    return NextResponse.json({ ok: true, worker: body.worker });
  } catch (error) {
    const message = (error as Error).name === 'AbortError'
      ? 'MCP health check timed out'
      : 'Bagseven MCP is not running on port 4009';
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
