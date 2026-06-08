/**
 * Content Script — ISOLATED world bridge.
 * Receives postMessage from injected script (MAIN world),
 * forwards to background service worker.
 * Shows a toast notification with tag selection after comment capture.
 */
(function () {
  'use strict';

  // Tag categories (keep in sync with shared/tags.js)
  const TAG_CATEGORIES = [
    {
      id: 'logging',
      label: 'Logging',
      tags: [
        { id: 'session_attended', label: 'Session Attended' },
        { id: 'qppm_provided', label: 'QPPM Provided' },
        { id: 'patch_provided', label: 'Patch Provided' },
        { id: 'issue_fix_list', label: 'Issue Fix List' },
      ]
    },
    {
      id: 'tracking',
      label: 'Tracking',
      tags: [
        { id: 'newly_assigned', label: 'Newly Assigned' },
        { id: 'existing_tickets', label: 'Existing Tickets' },
      ]
    }
  ];

  // --- Toast UI ---
  function injectToastStyles(isDark) {
    const existing = document.getElementById('zd-tracker-toast-styles');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = 'zd-tracker-toast-styles';
    style.textContent = `
      .zd-tracker-toast {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        background: ${isDark ? '#1a1a1a' : '#ffffff'};
        color: ${isDark ? '#ffffff' : '#1f2937'};
        border-radius: 12px;
        padding: 0;
        box-shadow: ${isDark ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)' : '0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)'};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        width: 480px;
        overflow: hidden;
        animation: zdToastSlideIn 0.3s cubic-bezier(0.21, 1.02, 0.73, 1);
        transition: opacity 0.3s, transform 0.3s;
      }
      .zd-tracker-toast.hiding {
        opacity: 0;
        transform: translateX(100%);
      }
      @keyframes zdToastSlideIn {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
      }
      .zd-tracker-toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: ${isDark ? '#67b26f' : '#4a9b55'};
        border-radius: 0 0 0 12px;
        animation: zdProgress 15s linear forwards;
        animation-play-state: running;
      }
      .zd-tracker-toast:hover .zd-tracker-toast-progress {
        animation-play-state: paused;
      }
      @keyframes zdProgress {
        from { width: 100%; }
        to { width: 0%; }
      }
      .zd-tracker-toast-body {
        padding: 12px 16px 8px;
      }
      .zd-tracker-toast-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
      }
      .zd-tracker-toast-icon {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: ${isDark ? 'rgba(103,178,111,0.12)' : 'rgba(74,155,85,0.08)'};
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .zd-tracker-toast-title {
        font-weight: 600;
        font-size: 13px;
        color: ${isDark ? '#ffffff' : '#111827'};
        flex: 1;
      }
      .zd-tracker-toast-close {
        background: none;
        border: none;
        color: ${isDark ? '#888' : '#9ca3af'};
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        transition: all 0.15s;
      }
      .zd-tracker-toast-close:hover {
        background: ${isDark ? '#2a2a2a' : '#f3f4f6'};
        color: ${isDark ? '#ccc' : '#374151'};
      }
      .zd-tracker-toast-subtitle {
        font-size: 12px;
        color: ${isDark ? '#ccc' : '#6b7280'};
        margin-bottom: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-left: 34px;
      }
      .zd-tracker-toast-category {
        margin-bottom: 6px;
        padding-left: 34px;
      }
      .zd-tracker-toast-category-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: ${isDark ? '#888' : '#9ca3af'};
        margin-bottom: 6px;
      }
      .zd-tracker-toast-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .zd-tracker-tag-btn {
        padding: 5px 12px;
        border-radius: 16px;
        border: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb'};
        background: ${isDark ? '#232323' : '#fff'};
        color: ${isDark ? '#ccc' : '#4b5563'};
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }
      .zd-tracker-tag-btn:hover {
        border-color: ${isDark ? '#67b26f' : '#4a9b55'};
        color: ${isDark ? '#67b26f' : '#4a9b55'};
        background: ${isDark ? 'rgba(103,178,111,0.12)' : 'rgba(74,155,85,0.08)'};
      }
      .zd-tracker-tag-btn.selected {
        background: ${isDark ? '#67b26f' : '#4a9b55'};
        border-color: ${isDark ? '#67b26f' : '#4a9b55'};
        color: #fff;
        font-weight: 600;
      }
      .zd-tracker-toast-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding: 8px 16px;
        border-top: 1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6'};
        background: ${isDark ? '#232323' : '#f9fafb'};
      }
      .zd-tracker-btn {
        padding: 7px 16px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
      }
      .zd-tracker-btn-skip {
        background: transparent;
        color: ${isDark ? '#888' : '#6b7280'};
      }
      .zd-tracker-btn-skip:hover {
        background: ${isDark ? '#2a2a2a' : '#e5e7eb'};
        color: ${isDark ? '#ccc' : '#374151'};
      }
      .zd-tracker-btn-apply {
        background: ${isDark ? '#67b26f' : '#4a9b55'};
        color: #fff;
      }
      .zd-tracker-btn-apply:hover {
        background: ${isDark ? '#5a9e62' : '#3d8548'};
      }
    `;
    document.head.appendChild(style);
  }

  function showTagToast(commentData) {
    // Get theme and custom tags from extension storage
    chrome.storage.local.get(['theme', 'customTags'], (settings) => {
      const isDark = (settings.theme || 'dark') === 'dark';
      const customTags = settings.customTags || [];

      injectToastStyles(isDark);

      // Remove any existing toast
      const existing = document.getElementById('zd-tracker-toast');
      if (existing) existing.remove();

      const selectedTags = new Set(['existing_tickets']);

      // Build categories with custom tags merged in
      const categories = TAG_CATEGORIES.map(cat => ({
        ...cat,
        tags: [...cat.tags, ...customTags.filter(ct => ct.category === cat.id)]
      }));

      const toast = document.createElement('div');
      toast.id = 'zd-tracker-toast';
      toast.className = 'zd-tracker-toast';

      const ticketTitle = commentData.ticketTitle || 'Ticket';
      const shortTitle = ticketTitle.length > 45 ? ticketTitle.substring(0, 45) + '...' : ticketTitle;

      toast.innerHTML = `
        <div class="zd-tracker-toast-body">
          <div class="zd-tracker-toast-header">
            <div class="zd-tracker-toast-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <span class="zd-tracker-toast-title">Comment Captured</span>
            <button class="zd-tracker-toast-close" id="zd-tracker-close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="zd-tracker-toast-subtitle" title="${ticketTitle}">${shortTitle}</div>
          <div id="zd-tracker-categories"></div>
        </div>
        <div class="zd-tracker-toast-actions">
          <button class="zd-tracker-btn zd-tracker-btn-skip" id="zd-tracker-skip">Skip</button>
          <button class="zd-tracker-btn zd-tracker-btn-apply" id="zd-tracker-apply">Apply Tags</button>
        </div>
        <div class="zd-tracker-toast-progress"></div>
      `;

      document.body.appendChild(toast);

      // Render categorized tag buttons
      const catContainer = document.getElementById('zd-tracker-categories');
      categories.forEach(cat => {
        if (cat.tags.length === 0) return;
        const section = document.createElement('div');
        section.className = 'zd-tracker-toast-category';
        section.innerHTML = `<div class="zd-tracker-toast-category-label">${cat.label}</div>`;
        const tagRow = document.createElement('div');
        tagRow.className = 'zd-tracker-toast-tags';

        cat.tags.forEach(tag => {
          const btn = document.createElement('button');
          btn.className = 'zd-tracker-tag-btn';
          if (selectedTags.has(tag.id)) btn.classList.add('selected');
          btn.textContent = tag.label;
          btn.dataset.tagId = tag.id;
          btn.addEventListener('click', () => {
            // Tracking tags are mutually exclusive
            if (tag.id === 'newly_assigned' || tag.id === 'existing_tickets') {
              const counterpart = tag.id === 'newly_assigned' ? 'existing_tickets' : 'newly_assigned';
              selectedTags.delete(counterpart);
              const counterpartBtn = tagRow.querySelector(`[data-tag-id="${counterpart}"]`);
              if (counterpartBtn) counterpartBtn.classList.remove('selected');
            }

            if (selectedTags.has(tag.id)) {
              selectedTags.delete(tag.id);
              btn.classList.remove('selected');
            } else {
              selectedTags.add(tag.id);
              btn.classList.add('selected');
            }
          });
          tagRow.appendChild(btn);
        });

        section.appendChild(tagRow);
        catContainer.appendChild(section);
      });

      // Auto-dismiss after 15 seconds (pauses on hover)
      let remaining = 15000;
      let timerStart = Date.now();
      let autoDismiss = setTimeout(() => dismissToast(), remaining);

      toast.addEventListener('mouseenter', () => {
        clearTimeout(autoDismiss);
        remaining -= (Date.now() - timerStart);
      });
      toast.addEventListener('mouseleave', () => {
        timerStart = Date.now();
        autoDismiss = setTimeout(() => dismissToast(), remaining);
      });

      function dismissToast() {
        clearTimeout(autoDismiss);
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
      }

      // Skip button
      document.getElementById('zd-tracker-skip').addEventListener('click', dismissToast);

      // Close button (X)
      document.getElementById('zd-tracker-close').addEventListener('click', dismissToast);

      // Apply button
      document.getElementById('zd-tracker-apply').addEventListener('click', () => {
        if (selectedTags.size > 0) {
          const today = new Date();
          const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          chrome.runtime.sendMessage({
            type: 'TAG_COMMENT',
            commentId: commentData.id,
            dateKey: dateKey,
            tags: Array.from(selectedTags)
          });
        }
        dismissToast();
      });
    });
  }

  // --- Message bridge ---
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== '__ZD_COMMENT_CAPTURED__') return;

    const payload = event.data.payload;
    if (!payload) return;

    // Extract ticket ID from current URL
    const match = window.location.href.match(/tickets\/details\/(\d+)/);
    const ticketId = match ? match[1] : 'unknown';

    // Grab ticket title from page
    const titleEl = document.querySelector('.ticket-subject') ||
                    document.querySelector('[data-testid="ticket-subject"]') ||
                    document.querySelector('h2.sub') ||
                    document.querySelector('.lv-subject-text');
    const ticketTitle = titleEl ? titleEl.textContent.trim() : document.title.replace(/ - Zoho Desk$/, '').trim();

    const commentData = {
      id: payload.id,
      ticketId: ticketId,
      ticketTitle: ticketTitle,
      content: payload.content,
      commentedTime: payload.commentedTime,
      commenter: payload.commenter,
      isPublic: payload.isPublic,
      capturedAt: new Date().toISOString(),
      url: window.location.href.split('?')[0]
    };

    // Forward to background
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'COMMENT_CAPTURED', data: commentData });
    }

    // Show tag toast on page
    showTagToast(commentData);
  });
})();
