// Sets data-theme before first paint so a dark-mode user never sees a cream
// flash. Loaded as a blocking classic script from <head>: after first paint is
// too late, and the production CSP (`script-src 'self'`, no nonce) rules out an
// inline script. React takes over once src/hooks/useTheme.ts runs; this only
// covers the frames before that.
//
// The storage key and accepted values must stay in sync with STORAGE_KEYS.THEME
// in src/api.ts and applyTheme() in src/hooks/useTheme.ts.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('porchsongs_theme');
  } catch (e) {
    // Storage can be unavailable (privacy modes, blocked site data); the OS
    // preference below is the right answer then.
  }
  var theme = stored === 'light' || stored === 'dark' ? stored : null;
  if (!theme) {
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    theme = mq && mq.matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
