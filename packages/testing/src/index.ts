export async function runConcurrently<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => task(i)));
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 50;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}