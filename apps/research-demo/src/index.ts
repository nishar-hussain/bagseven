import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { runResearch, type ResearchEvent } from './agent.js';

try { for (const line of readFileSync('.env', 'utf8').split('\n')) { const index = line.indexOf('='); if (index > 0 && process.env[line.slice(0, index)] === undefined) process.env[line.slice(0, index)] = line.slice(index + 1); } } catch { /* optional */ }

interface Run { id: string; status: 'running' | 'completed' | 'failed' | 'refused'; question: string; scenario: 'approved' | 'blocked'; events: ResearchEvent[]; summary?: string; error?: string }
const runs = new Map<string, Run>();
const app = Fastify({ logger: { name: 'bagseven-research-demo' } });
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

app.get('/healthz', async () => ({ ok: true, service: 'bagseven-research-demo' }));
app.get('/', async (_request, reply) => reply.type('text/html').send(html));
app.get('/api/runs/:id', async (request, reply) => { const run = runs.get((request.params as { id: string }).id); return run ? run : reply.code(404).send({ error: 'run_not_found' }); });
app.post('/api/research', async (request, reply) => {
  const body = request.body as { question?: string; scenario?: 'approved' | 'blocked' };
  const question = body.question?.trim();
  if (!question) return reply.code(400).send({ error: 'question_required' });
  const run: Run = { id: randomUUID(), status: 'running', question, scenario: body.scenario === 'blocked' ? 'blocked' : 'approved', events: [] };
  runs.set(run.id, run);
  const emit = (event: ResearchEvent) => run.events.push(event);
  void runResearch({ question, scenario: run.scenario, emit }).then((result) => { run.status = result.status; run.summary = result.summary; }).catch((error) => { run.status = 'failed'; run.error = (error as Error).message; emit({ type: 'error', message: run.error, at: new Date().toISOString() }); });
  return reply.code(202).send({ run_id: run.id });
});

const port = Number(process.env.RESEARCH_DEMO_PORT ?? 4020);
app.listen({ port, host: '0.0.0.0' }).then(() => app.log.info({ port }, 'research demo listening')).catch((error) => { console.error(error); process.exit(1); });
