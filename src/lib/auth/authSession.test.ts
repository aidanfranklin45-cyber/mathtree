import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';

// Set up mock storage before loading session.js
class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

// Ensure window and storage exist in test environment
const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();

const mockLocation = {
  hostname: 'localhost',
  pathname: '/dashboard',
  search: '',
  hash: '',
  replace: vi.fn(),
  href: 'http://localhost:3000/dashboard',
};

// Install globals
(globalThis as any).window = (globalThis as any).window || {};
(globalThis as any).window.localStorage = mockLocalStorage;
(globalThis as any).window.sessionStorage = mockSessionStorage;
(globalThis as any).window.location = mockLocation;
(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).sessionStorage = mockSessionStorage;

// Mock supabase client before importing AuthGate
const mockGetSession = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({});
const mockOnAuthStateChange = vi.fn().mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
});

vi.mock('../supabase/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
    },
  },
}));

// Load session.js
await import('../../../session.js');
const session = (globalThis as any).MathTreeSession;
(globalThis as any).window.MathTreeSession = session;

// Import AuthGate helpers
const { AuthGate, checkRedirectLoop, evaluateAuthSession } = await import('./AuthGate');

describe('MathTreeSession & Auth Unit Tests', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    mockLocation.replace.mockClear();
    mockGetSession.mockReset();
    mockSignOut.mockClear();
    mockOnAuthStateChange.mockClear();
    vi.restoreAllMocks();
    (globalThis as any).window.MathTreeSession = session;
  });

  describe('isValidSession', () => {
    it('returns false for null or undefined session', () => {
      expect(session.isValidSession(null)).toBe(false);
      expect(session.isValidSession(undefined)).toBe(false);
    });

    it('returns false when access_token is missing', () => {
      expect(session.isValidSession({ expires_at: Math.floor(Date.now() / 1000) + 3600 })).toBe(false);
      expect(session.isValidSession({ access_token: '' })).toBe(false);
    });

    it('returns false when expires_at is in the past', () => {
      const past = Math.floor(Date.now() / 1000) - 100;
      expect(session.isValidSession({ access_token: 'valid_tok', expires_at: past })).toBe(false);
    });

    it('returns false when session has timed out from inactivity', () => {
      // Record activity 31 minutes ago (exceeding 30 minute TIMEOUT_MS)
      const expiredActivity = Date.now() - (31 * 60 * 1000);
      mockLocalStorage.setItem('mathtree_last_activity', String(expiredActivity));

      const future = Math.floor(Date.now() / 1000) + 3600;
      expect(session.isValidSession({ access_token: 'valid_tok', expires_at: future })).toBe(false);
    });

    it('returns true when valid access_token, unexpired expires_at, and not timed out', () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      const recentActivity = Date.now() - 5000;
      mockLocalStorage.setItem('mathtree_last_activity', String(recentActivity));

      expect(session.isValidSession({ access_token: 'valid_tok', expires_at: future })).toBe(true);
    });
  });

  describe('clearAuthStorage', () => {
    it('removes only sb-*-auth-token, mathtree_last_activity and mathtree_active_user, and leaves mathtree_deals_* / demo keys alone', () => {
      mockLocalStorage.setItem('sb-test-auth-token', 'token_123');
      mockLocalStorage.setItem('mathtree_last_activity', '123456');
      mockLocalStorage.setItem('mathtree_active_user', '{"id":"u1"}');
      mockLocalStorage.setItem('mathtree_demo_mode', '{"demo":true}');
      mockLocalStorage.setItem('mathtree_local_deals', '["d1"]');
      mockLocalStorage.setItem('mathtree_demo_deals', '["demo1"]');
      mockLocalStorage.setItem('mathtree_deals_123', '{"deal":123}');

      session.clearAuthStorage();

      // Auth keys removed
      expect(mockLocalStorage.getItem('sb-test-auth-token')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_last_activity')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_active_user')).toBeNull();

      // Deal and demo keys preserved
      expect(mockLocalStorage.getItem('mathtree_demo_mode')).toBe('{"demo":true}');
      expect(mockLocalStorage.getItem('mathtree_local_deals')).toBe('["d1"]');
      expect(mockLocalStorage.getItem('mathtree_demo_deals')).toBe('["demo1"]');
      expect(mockLocalStorage.getItem('mathtree_deals_123')).toBe('{"deal":123}');
    });
  });

  describe('clearSessionStorage', () => {
    it('clearSessionStorage({ authOnly: true }) clears auth keys only', () => {
      mockLocalStorage.setItem('sb-test-auth-token', 'token_123');
      mockLocalStorage.setItem('mathtree_last_activity', '123456');
      mockLocalStorage.setItem('mathtree_active_user', '{"id":"u1"}');
      mockLocalStorage.setItem('mathtree_local_deals', '["d1"]');
      mockLocalStorage.setItem('mathtree_demo_deals', '["demo1"]');

      session.clearSessionStorage({ authOnly: true });

      expect(mockLocalStorage.getItem('sb-test-auth-token')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_last_activity')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_active_user')).toBeNull();

      expect(mockLocalStorage.getItem('mathtree_local_deals')).toBe('["d1"]');
      expect(mockLocalStorage.getItem('mathtree_demo_deals')).toBe('["demo1"]');
    });

    it('clearSessionStorage() clears everything including demo and local deals', () => {
      mockLocalStorage.setItem('sb-test-auth-token', 'token_123');
      mockLocalStorage.setItem('mathtree_last_activity', '123456');
      mockLocalStorage.setItem('mathtree_active_user', '{"id":"u1"}');
      mockLocalStorage.setItem('mathtree_demo_mode', '{"demo":true}');
      mockLocalStorage.setItem('mathtree_local_deals', '["d1"]');
      mockLocalStorage.setItem('mathtree_demo_deals', '["demo1"]');
      mockLocalStorage.setItem('mathtree_active_deal', 'd1');
      mockLocalStorage.setItem('mathtree_deals_xyz', '{"x":1}');
      mockSessionStorage.setItem('mathtree_active_deal_id', 'd1');

      session.clearSessionStorage();

      expect(mockLocalStorage.getItem('sb-test-auth-token')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_last_activity')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_active_user')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_demo_mode')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_local_deals')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_demo_deals')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_active_deal')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_deals_xyz')).toBeNull();
      expect(mockSessionStorage.getItem('mathtree_active_deal_id')).toBeNull();
    });
  });

  describe('checkRedirectLoop', () => {
    it('the 3rd bounce within 10s returns true and clears only auth keys', () => {
      mockLocalStorage.setItem('sb-test-auth-token', 'token_123');
      mockLocalStorage.setItem('mathtree_last_activity', '123456');
      mockLocalStorage.setItem('mathtree_local_deals', '["deal_saved"]');

      expect(checkRedirectLoop()).toBe(false); // bounce 1
      expect(checkRedirectLoop()).toBe(false); // bounce 2
      expect(checkRedirectLoop()).toBe(true);  // bounce 3

      // Auth keys wiped
      expect(mockLocalStorage.getItem('sb-test-auth-token')).toBeNull();
      expect(mockLocalStorage.getItem('mathtree_last_activity')).toBeNull();

      // Local deal data preserved
      expect(mockLocalStorage.getItem('mathtree_local_deals')).toBe('["deal_saved"]');
    });

    it('a bounce after 10s resets the count and returns false', () => {
      const elevenSecAgo = Date.now() - 11000;
      mockSessionStorage.setItem('mathtree_redirect_guard', JSON.stringify({ count: 2, first: elevenSecAgo }));

      // Because > 10s passed, count resets to 1, returning false
      expect(checkRedirectLoop()).toBe(false);

      const guard = JSON.parse(mockSessionStorage.getItem('mathtree_redirect_guard')!);
      expect(guard.count).toBe(1);
    });
  });

  describe('AuthGate component', () => {
    it('a stale session leads to a clearAuthStorage call and a redirect', async () => {
      const past = Math.floor(Date.now() / 1000) - 300;
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'stale_token', expires_at: past } },
      });

      const clearAuthSpy = vi.spyOn(session, 'clearAuthStorage');

      const status = await evaluateAuthSession();

      expect(status).toBe('redirected');
      expect(clearAuthSpy).toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockLocation.replace).toHaveBeenCalledWith(session.getLoginUrl());
    });

    it('a valid session leads to rendering the children', async () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'active_token', expires_at: future } },
      });

      const status = await evaluateAuthSession();
      expect(status).toBe('authenticated');
      expect(mockLocation.replace).not.toHaveBeenCalled();

      // Test AuthGate React component rendering inside React context
      const { renderToStaticMarkup } = await import('react-dom/server');
      const html = renderToStaticMarkup(React.createElement(AuthGate, null, 'Child Content'));
      expect(html).toContain('animate-spin');
    });
  });
});
