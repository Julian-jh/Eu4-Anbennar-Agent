/* This classic script runs in the head, before the workspace is painted. */
(() => {
  'use strict';
  const storageKey = 'ai-center.appearance.v1';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const html = document.documentElement;
  let choice = 'system';

  function apply(value) {
    choice = value === 'dark' || value === 'light' ? value : 'system';
    const dark = choice === 'system' ? system.matches : choice === 'dark';
    html.dataset.themeChoice = choice;
    html.dataset.theme = dark ? 'dark' : 'light';
    const browserBar = document.querySelector('meta[name="theme-color"]');
    if (browserBar) browserBar.content = dark ? '#101010' : '#234d40';
    const picker = document.getElementById('ac-theme');
    if (picker) picker.value = choice;
  }

  function readChoice() {
    try { return localStorage.getItem(storageKey); }
    catch { return choice; }
  }

  apply(readChoice());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply(choice), {once:true});
  }
  document.addEventListener('change', event => {
    if (event.target.id !== 'ac-theme') return;
    apply(event.target.value);
    try { localStorage.setItem(storageKey, choice); } catch { /* Keep the choice for this page. */ }
  });
  const followSystem = () => { if (choice === 'system') apply(choice); };
  if (system.addEventListener) system.addEventListener('change', followSystem);
  else system.addListener(followSystem);
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) apply(readChoice());
  });
  window.addEventListener('pageshow', event => { if (event.persisted) apply(readChoice()); });
})();
