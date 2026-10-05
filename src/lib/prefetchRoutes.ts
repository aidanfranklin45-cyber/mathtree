/** Warm route chunks ahead of navigation so clicks don't wait on a download. */
let operationsChunk: Promise<unknown> | null = null;
let compareChunk: Promise<unknown> | null = null;
let studioChunk: Promise<unknown> | null = null;

export const importOperationsPage = () => import('../pages/OperationsPage');
export const importComparePage = () => import('../pages/ComparePage');
export const importDealStudioPage = () => import('../pages/DealStudioPage');

export function prefetchOperations(): void {
  if (!operationsChunk) operationsChunk = importOperationsPage().catch(() => { operationsChunk = null; });
}

export function prefetchCompare(): void {
  if (!compareChunk) compareChunk = importComparePage().catch(() => { compareChunk = null; });
}

export function prefetchStudio(): void {
  if (!studioChunk) studioChunk = importDealStudioPage().catch(() => { studioChunk = null; });
}

/** Warm all primary application hubs in the background during idle moments. */
export function prefetchCoreRoutes(): void {
  prefetchStudio();
  prefetchOperations();
  prefetchCompare();
}

/** Hover / focus / touch handlers to spread onto a link or card that goes to Deal Studio. */
export const studioPrefetchProps = {
  onMouseEnter: prefetchStudio,
  onFocus: prefetchStudio,
  onTouchStart: prefetchStudio,
};

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
