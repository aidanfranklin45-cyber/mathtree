import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isChunkLoadError, triggerChunkReload } from './lazyWithRetry';
import { prefetchCompare, importComparePage } from './prefetchRoutes';

class MockStorage {
  private store = new Map<string, string>();
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, val: string) { this.store.set(key, String(val)); }
  removeItem(key: string) { this.store.delete(key); }
}

describe('lazyWithRetry and chunk recovery', () => {
  const originalWindow = (globalThis as any).window;
  let mockStorage: MockStorage;
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStorage = new MockStorage();
    reloadMock = vi.fn();
    (globalThis as any).window = {
      location: { reload: reloadMock },
      sessionStorage: mockStorage,
      addEventListener: vi.fn(),
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

  it('provides prefetchCompare route warmer', () => {
    expect(typeof prefetchCompare).toBe('function');
    expect(typeof importComparePage).toBe('function');
  });
});
