export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const size = Math.min(limit, items.length);
  if (size <= 0) return;
  let index = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < size; i += 1) {
    runners.push(
      (async (): Promise<void> => {
        for (;;) {
          const current = index;
          index += 1;
          if (current >= items.length) return;
          await worker(items[current] as T);
        }
      })(),
    );
  }
  await Promise.all(runners);
}
