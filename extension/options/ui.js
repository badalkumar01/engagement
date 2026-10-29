// Theme toggle + sidebar navigation. External file because MV3 blocks inline
// <script> on extension pages (that was why the nav buttons did nothing).

(function themeToggle() {
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
  function render(t) {
    var icon = document.getElementById('themeIcon');
    var label = document.getElementById('themeLabel');
    if (icon) icon.innerHTML = t === 'dark' ? SUN : MOON;
    if (label) label.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  }
  render(document.documentElement.getAttribute('data-theme') || 'light');
  var btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var t = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('ea-theme', t); } catch (e) {}
      render(t);
    });
  }
})();

(function sidebarNav() {
  var items = Array.prototype.slice.call(document.querySelectorAll('.nav-item'));
  var panes = document.querySelectorAll('.pane');
  var title = document.getElementById('paneTitle');
  function show(name) {
    panes.forEach(function (p) { p.hidden = p.dataset.pane !== name; });
    items.forEach(function (b) {
      var on = b.dataset.pane === name;
      b.classList.toggle('active', on);
      if (on && title) title.textContent = b.dataset.title;
    });
    try { localStorage.setItem('ea-pane', name); } catch (e) {}
  }
  items.forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.pane); }); });
  var start = 'connection';
  try { start = localStorage.getItem('ea-pane') || 'connection'; } catch (e) {}
  if (!items.some(function (b) { return b.dataset.pane === start; })) start = 'connection';
  show(start);
})();
