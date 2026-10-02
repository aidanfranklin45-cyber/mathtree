/** Warm the Operations route chunk ahead of navigation so the click doesn't wait on a download. */
let operationsChunk: Promise<unknown> | null = null;

export const importOperationsPage = () => import('../pages/OperationsPage');

export function prefetchOperations(): void {
  if (!operationsChunk) operationsChunk = importOperationsPage().catch(() => { operationsChunk = null; });
}

/** Hover / focus / touch handlers to spread onto a link that goes to /operations. */
export const operationsPrefetchProps = {
  onMouseEnter: prefetchOperations,
  onFocus: prefetchOperations,
  onTouchStart: prefetchOperations,
};
