/**
 * Work a request starts but doesn't wait for, such as saving a streamed reply
 * after the response has been returned. Routes hand it to `background`.
 */
export type Background = (work: Promise<unknown>) => void;

/**
 * Collects a request's background work, so the Worker can keep the request
 * alive (and its database client open) until all of it has settled.
 * Work must be registered before the response is returned.
 */
export function createBackgroundTracker() {
  const pending: Promise<unknown>[] = [];
  const background: Background = (work) => {
    pending.push(work);
  };
  /** Resolves once every registered piece of work has settled. */
  const settled = async () => {
    await Promise.allSettled(pending);
  };
  return { background, settled };
}
