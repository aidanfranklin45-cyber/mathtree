/** Warm route chunks ahead of navigation so the click doesn't wait on a download. */
let operationsChunk: Promise<unknown> | null = null;
let compareChunk: Promise<unknown> | null = null;

export const importOperationsPage = () => import('../pages/OperationsPage');
export const importComparePage = () => import('../pages/ComparePage');

export function prefetchOperations(): void {
  if (!operationsChunk) operationsChunk = importOperationsPage().catch(() => { operationsChunk = null; });
}

export function prefetchCompare(): void {
  if (!compareChunk) compareChunk = importComparePage().catch(() => { compareChunk = null; });
}

/** Hover / focus / touch handlers to spread onto a link that goes to /operations. */
export const operationsPrefetchProps = {
  onMouseEnter: prefetchOperations,
  onFocus: prefetchOperations,
  onTouchStart: prefetchOperations,
};

/** Hover / focus / touch handlers to spread onto a link that goes to /compare. */
export const comparePrefetchProps = {
  onMouseEnter: prefetchCompare,
  onFocus: prefetchCompare,
  onTouchStart: prefetchCompare,
};
