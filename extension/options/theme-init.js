// Sets the saved theme before the page paints, to avoid a flash.
// External file because MV3 blocks inline <script> on extension pages.
(function () {
  try {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('ea-theme') || 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
