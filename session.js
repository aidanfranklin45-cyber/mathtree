/**
 * MathTree Session & Inactivity Management
 * Automatically logs users out after 30 minutes of inactivity.
 * Syncs activity across tabs via localStorage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathTreeSession = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY_LAST_ACTIVITY = 'mathtree_last_activity';
  var STORAGE_KEY_DEMO = 'mathtree_demo_mode';
  var TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  var WARNING_MS = 60 * 1000;      // 1 minute before timeout
  var CHECK_INTERVAL_MS = 5 * 1000; // Check every 5 seconds
  var THROTTLE_MS = 2000;          // Record activity at most once every 2 seconds

  var lastRecordedTime = 0;
  var watcherInterval = null;
  var warningModalEl = null;

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage;
      }
    } catch (e) {}
    return null;
  }

  function recordActivity() {
    var now = Date.now();
    if (now - lastRecordedTime < THROTTLE_MS) {
      return;
    }
    lastRecordedTime = now;
    var storage = getStorage();
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(now));
      } catch (e) {}
    }
    hideWarningModal();
  }

  function getLastActivity() {
    var storage = getStorage();
    if (!storage) return 0;
    try {
      var val = storage.getItem(STORAGE_KEY_LAST_ACTIVITY);
      var parsed = val ? parseInt(val, 10) : 0;
      return isNaN(parsed) ? 0 : parsed;
    } catch (e) {
      return 0;
    }
  }

  function isTimedOut(customTimeoutMs) {
    var last = getLastActivity();
    if (!last) {
      // If no activity has ever been recorded, session hasn't started or is invalid
      return false;
    }
    var limit = typeof customTimeoutMs === 'number' ? customTimeoutMs : TIMEOUT_MS;
    return (Date.now() - last) >= limit;
  }

  function getRemainingTime(customTimeoutMs) {
    var last = getLastActivity();
    if (!last) return 0;
    var limit = typeof customTimeoutMs === 'number' ? customTimeoutMs : TIMEOUT_MS;
    var elapsed = Date.now() - last;
    return Math.max(0, limit - elapsed);
  }

  function clearSessionStorage() {
    var storage = getStorage();
    if (storage) {
      try {
        storage.removeItem(STORAGE_KEY_LAST_ACTIVITY);
        storage.removeItem(STORAGE_KEY_DEMO);
      } catch (e) {}
    }
  }

  function logout(reason, supabaseClient, redirectUrl) {
    reason = reason || 'timeout';
    redirectUrl = redirectUrl || ('index.html' + (reason === 'timeout' ? '?reason=timeout' : ''));

    clearSessionStorage();
    hideWarningModal();

    if (watcherInterval) {
      clearInterval(watcherInterval);
      watcherInterval = null;
    }

    var client = supabaseClient || (typeof window !== 'undefined' ? (window._supabase || window.supabaseClient) : null);
    if (client && client.auth && typeof client.auth.signOut === 'function') {
      try {
        client.auth.signOut().finally(function () {
          if (typeof window !== 'undefined' && window.location) {
            window.location.replace(redirectUrl);
          }
        });
        return;
      } catch (e) {}
    }

    if (typeof window !== 'undefined' && window.location) {
      window.location.replace(redirectUrl);
    }
  }

  function renderWarningModal(secondsLeft, onKeepAlive) {
    if (typeof document === 'undefined') return;

    if (!warningModalEl) {
      warningModalEl = document.createElement('div');
      warningModalEl.id = 'mathtree-timeout-modal';
      warningModalEl.className = 'fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in';
      warningModalEl.innerHTML = [
        '<div class="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl shadow-amber-500/10 text-center relative">',
        '  <div class="h-12 w-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3">',
        '    <svg class="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">',
        '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />',
        '    </svg>',
        '  </div>',
        '  <h3 class="text-base font-bold text-white mb-1">Inactivity Timeout Warning</h3>',
        '  <p class="text-xs text-slate-400 mb-4">',
        '    You have been inactive. For your portfolio data security, your session will automatically log out in ',
        '    <span id="mathtree-timeout-sec" class="text-amber-400 font-bold font-mono text-sm">60</span>s.',
        '  </p>',
        '  <div class="flex space-x-2">',
        '    <button id="mathtree-keepalive-btn" type="button" class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs transition shadow-md shadow-emerald-900/30">',
        '      Stay Signed In',
        '    </button>',
        '    <button id="mathtree-logout-now-btn" type="button" class="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition">',
        '      Sign Out',
        '    </button>',
        '  </div>',
        '</div>'
      ].join('');

      document.body.appendChild(warningModalEl);

      var keepAliveBtn = warningModalEl.querySelector('#mathtree-keepalive-btn');
      if (keepAliveBtn) {
        keepAliveBtn.addEventListener('click', function () {
          recordActivity();
          if (typeof onKeepAlive === 'function') onKeepAlive();
        });
      }

      var logoutBtn = warningModalEl.querySelector('#mathtree-logout-now-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
          logout('user');
        });
      }
    }

    var secEl = warningModalEl.querySelector('#mathtree-timeout-sec');
    if (secEl) {
      secEl.textContent = String(Math.max(0, Math.ceil(secondsLeft)));
    }
  }

  function hideWarningModal() {
    if (warningModalEl && warningModalEl.parentNode) {
      warningModalEl.parentNode.removeChild(warningModalEl);
      warningModalEl = null;
    }
  }

  function attachActivityListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    var events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(function (evtName) {
      window.addEventListener(evtName, recordActivity, { passive: true });
    });
  }

  function startWatcher(supabaseClient, options) {
    options = options || {};
    var timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : TIMEOUT_MS;
    var warningMs = typeof options.warningMs === 'number' ? options.warningMs : WARNING_MS;

    // Attach listeners so any action resets the timer
    attachActivityListeners();

    // If activity hasn't been set yet in this session, initialize it now
    if (!getLastActivity()) {
      recordActivity();
    }

    if (watcherInterval) {
      clearInterval(watcherInterval);
    }

    watcherInterval = setInterval(function () {
      var remaining = getRemainingTime(timeoutMs);

      if (remaining <= 0) {
        logout('timeout', supabaseClient);
      } else if (remaining <= warningMs) {
        renderWarningModal(remaining / 1000, function () {
          recordActivity();
        });
      } else {
        hideWarningModal();
      }
    }, CHECK_INTERVAL_MS);

    // Initial check right away
    var initialRemaining = getRemainingTime(timeoutMs);
    if (initialRemaining <= 0) {
      logout('timeout', supabaseClient);
    } else if (initialRemaining <= warningMs) {
      renderWarningModal(initialRemaining / 1000);
    }
  }

  return {
    TIMEOUT_MS: TIMEOUT_MS,
    WARNING_MS: WARNING_MS,
    recordActivity: recordActivity,
    getLastActivity: getLastActivity,
    isTimedOut: isTimedOut,
    getRemainingTime: getRemainingTime,
    clearSessionStorage: clearSessionStorage,
    logout: logout,
    renderWarningModal: renderWarningModal,
    hideWarningModal: hideWarningModal,
    attachActivityListeners: attachActivityListeners,
    startWatcher: startWatcher
  };
}));
