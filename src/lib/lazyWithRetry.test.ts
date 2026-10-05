import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isChunkLoadError, triggerChunkReload, checkDeploymentFreshness } from './lazyWithRetry';
import { prefetchCompare, importComparePage, prefetchStudio, importDealStudioPage, prefetchCoreRoutes } from './prefetchRoutes';

class MockStorage {
  private store = new Map<string, string>();
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, val: string) { this.store.set(key, String(val)); }
  removeItem(key: string) { this.store.delete(key); }
}

describe('lazyWithRetry and global self-healing', () => {
  const originalWindow = (globalThis as any).window;
  let mockStorage: MockStorage;
  let reloadMock: ReturnType<typeof vi.fn>;
  let assignMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStorage = new MockStorage();
    reloadMock = vi.fn();
    assignMock = vi.fn();
    (globalThis as any).window = {
      location: {
        href: 'https://mathtree-app.web.app/dashboard',
        reload: reloadMock,
        assign: assignMock,
      },
      sessionStorage: mockStorage,
      addEventListener: vi.fn(),
      fetch: vi.fn(),
    };
    (globalThis as any).sessionStorage = mockStorage;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    delete (globalThis as any).sessionStorage;
    vi.restoreAllMocks();
  });

  it('detects dynamic import / chunk load failure messages', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://mathtree-app.web.app/assets/ComparePage-CRxCCosP.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://mathtree-app.web.app/assets/DealStudioPage-DjWESSjs.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 404 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined (reading "title")'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('triggers reload on first chunk failure and records timestamp guard', () => {
    const result = triggerChunkReload();
    expect(result).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(mockStorage.getItem('mathtree_chunk_reload_guard')).toBeTruthy();
  });

  it('navigates directly to target URL on chunk reload if provided', () => {
    const target = 'https://mathtree-app.web.app/project?id=123';
    const result = triggerChunkReload(target);
    expect(result).toBe(true);
    expect(assignMock).toHaveBeenCalledWith(target);
  });

  it('blocks reload loops within the reload window', () => {
    // First reload passes
    const first = triggerChunkReload();
    expect(first).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // Immediate second attempt within 15 seconds is blocked to avoid infinite reload loop
    const second = triggerChunkReload();
    expect(second).toBe(false);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('detects when server deployment changes via checkDeploymentFreshness', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: {
        get: (h: string) => (h === 'etag' ? '"build-v2"' : null),
      },
    });
    (globalThis as any).window.fetch = fetchMock;

    // First check records baseline etag and returns false
    const first = await checkDeploymentFreshness();
    expect(first).toBe(false);
    expect(mockStorage.getItem('mathtree_build_etag')).toBe('"build-v2"');

    // Second check with same etag returns false
    const second = await checkDeploymentFreshness();
    expect(second).toBe(false);

    // Third check with newer etag detects deployment change
    fetchMock.mockResolvedValueOnce({
      headers: {
        get: (h: string) => (h === 'etag' ? '"build-v3"' : null),
      },
    });
    const third = await checkDeploymentFreshness();
    expect(third).toBe(true);
    expect(mockStorage.getItem('mathtree_build_etag')).toBe('"build-v3"');
  });

  it('provides prefetch utilities for all primary hubs', () => {
    expect(typeof prefetchStudio).toBe('function');
    expect(typeof importDealStudioPage).toBe('function');
    expect(typeof prefetchCompare).toBe('function');
    expect(typeof importComparePage).toBe('function');
    expect(typeof prefetchCoreRoutes).toBe('function');
  });
});
