/* ==========================================================================
   WebPeel Documentation — Interactive Features
   ========================================================================== */

(function () {
  'use strict';

  /* ---------- 1. Tab Switching ---------- */
  function initTabs() {
    document.querySelectorAll('.tabs').forEach(function (tabBar) {
      var buttons = tabBar.querySelectorAll('.tab-btn');

      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tabId = btn.getAttribute('data-tab');
          if (!tabId) return;

          // Deactivate sibling buttons
          buttons.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');

          // Find all tab-content that follow this tab bar (until the next non-tab-content sibling)
          var sibling = tabBar.nextElementSibling;
          while (sibling && sibling.classList.contains('tab-content')) {
            if (sibling.getAttribute('data-content') === tabId) {
              sibling.classList.add('active');
            } else {
              sibling.classList.remove('active');
            }
            sibling = sibling.nextElementSibling;
          }
        });
      });
    });
  }

  /* ---------- 2. Sidebar Active State ---------- */
  function initSidebarActiveState() {
    var currentPath = window.location.pathname;

    // Normalise trailing slash
    if (currentPath.endsWith('/index.html')) {
      currentPath = currentPath.replace('/index.html', '/');
    }

    document.querySelectorAll('.sidebar-link').forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      // Compare normalised paths
      var linkPath = href;
      if (linkPath.endsWith('/index.html')) {
        linkPath = linkPath.replace('/index.html', '/');
      }

      link.classList.remove('active');
      if (linkPath === currentPath) {
        link.classList.add('active');
      }
    });
  }

  /* ---------- 3. Mobile Sidebar Toggle ---------- */
  function initMobileMenu() {
    var nav = document.querySelector('.nav-inner');
    var sidebar = document.querySelector('.sidebar');
    if (!nav || !sidebar) return;

    // Create hamburger button
    var hamburger = document.createElement('button');
    hamburger.className = 'hamburger-btn';
    hamburger.setAttribute('aria-label', 'Toggle menu');
    hamburger.innerHTML =
      '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
      '<line x1="3" y1="4.5" x2="15" y2="4.5"/>' +
      '<line x1="3" y1="9" x2="15" y2="9"/>' +
      '<line x1="3" y1="13.5" x2="15" y2="13.5"/>' +
      '</svg>';

    nav.appendChild(hamburger);

    // Create overlay
    var overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
      hamburger.setAttribute('aria-expanded', 'true');
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      hamburger.setAttribute('aria-expanded', 'false');
    }

    hamburger.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    overlay.addEventListener('click', closeSidebar);

    // Close on link click (mobile)
    sidebar.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        if (window.innerWidth <= 768) {
          closeSidebar();
        }
      });
    });

    // Close on escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });

    // Close if resized to desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) closeSidebar();
    });
  }

  /* ---------- 4. Smooth Scroll to Anchors ---------- */
  function initSmoothScroll() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;

      var id = link.getAttribute('href').slice(1);
      if (!id) return;

      var target = document.getElementById(id);
      if (!target) return;

      e.preventDefault();

      var navHeight = 56;
      var offsetTop = target.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;

      window.scrollTo({
        top: offsetTop,
        behavior: 'smooth'
      });

      // Update URL hash without jumping
      history.pushState(null, '', '#' + id);
    });
  }

  /* ---------- 5. Copy Code Button ---------- */
  function initCopyButtons() {
    document.querySelectorAll('pre').forEach(function (pre) {
      // Skip if already has a copy button
      if (pre.querySelector('.copy-btn')) return;

      var codeEl = pre.querySelector('code');
      if (!codeEl) return;

      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code to clipboard');

      btn.addEventListener('click', function () {
        var text = codeEl.textContent || '';

        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');

          setTimeout(function () {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        }).catch(function () {
          // Fallback for older browsers
          var textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(function () {
              btn.textContent = 'Copy';
              btn.classList.remove('copied');
            }, 2000);
          } catch (_) { /* ignore */ }
          document.body.removeChild(textarea);
        });
      });

      pre.appendChild(btn);
    });
  }

  /* ---------- 6. Scroll-Spy: Highlight Sidebar Section ---------- */
  function initScrollSpy() {
    var headings = Array.from(
      document.querySelectorAll('.docs-content h2[id], .docs-content h3[id]')
    );
    if (!headings.length) return;

    var sidebarLinks = Array.from(document.querySelectorAll('.sidebar-link[href^="#"]'));
    if (!sidebarLinks.length) return;

    // Build map: id -> sidebar link
    var linkMap = {};
    sidebarLinks.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      if (id) linkMap[id] = link;
    });

    var navHeight = 56;
    var ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(function () {
        ticking = false;

        var current = null;
        for (var i = 0; i < headings.length; i++) {
          var rect = headings[i].getBoundingClientRect();
          if (rect.top <= navHeight + 80) {
            current = headings[i];
          } else {
            break;
          }
        }

        if (!current) return;

        var id = current.getAttribute('id');
        if (!linkMap[id]) return;

        // Only update if changed
        sidebarLinks.forEach(function (link) {
          if (link === linkMap[id]) {
            link.classList.add('active');
          } else if (link.getAttribute('href').startsWith('#')) {
            // Only toggle hash links — leave page-level links alone
            link.classList.remove('active');
          }
        });
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial check
    onScroll();
  }

  /* ---------- Init on DOM ready ---------- */
  function init() {
    initTabs();
    initSidebarActiveState();
    initMobileMenu();
    initSmoothScroll();
    initCopyButtons();
    initScrollSpy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
