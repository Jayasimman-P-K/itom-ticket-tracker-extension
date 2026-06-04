/**
 * Content Script — ISOLATED world bridge.
 * Receives postMessage from injected script (MAIN world),
 * forwards to background service worker.
 * Shows a toast notification with tag selection after comment capture.
 */
(function () {
  'use strict';

  // Available tags (keep in sync with shared/tags.js)
  const AVAILABLE_TAGS = [
    { id: 'session_attended', label: 'Session Attended' },
    { id: 'qppm_provided', label: 'QPPM Provided' },
    { id: 'patch_provided', label: 'Patch Provided' },
    { id: 'issue_fix_list', label: 'Issue Fix List' },
  ];

  // --- Toast UI ---
  function injectToastStyles() {
    if (document.getElementById('zd-tracker-toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'zd-tracker-toast-styles';
    style.textContent = `
      .zd-tracker-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: #1e293b;
        color: #f1f5f9;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        max-width: 320px;
        animation: zdToastSlideIn 0.3s ease;
        transition: opacity 0.3s, transform 0.3s;
      }
      .zd-tracker-toast.hiding {
        opacity: 0;
        transform: translateY(10px);
      }
      @keyframes zdToastSlideIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .zd-tracker-toast-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }
      .zd-tracker-toast-header svg {
        flex-shrink: 0;
      }
      .zd-tracker-toast-title {
        font-weight: 600;
        font-size: 13px;
        color: #10b981;
      }
      .zd-tracker-toast-subtitle {
        font-size: 11px;
        color: #94a3b8;
        margin-bottom: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .zd-tracker-toast-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
      }
      .zd-tracker-tag-btn {
        padding: 5px 10px;
        border-radius: 6px;
        border: 1px solid #334155;
        background: #0f172a;
        color: #cbd5e1;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .zd-tracker-tag-btn:hover {
        border-color: #10b981;
        color: #10b981;
      }
      .zd-tracker-tag-btn.selected {
        background: #10b981;
        border-color: #10b981;
        color: #fff;
        font-weight: 600;
      }
      .zd-tracker-toast-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .zd-tracker-btn {
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
      }
      .zd-tracker-btn-skip {
        background: transparent;
        color: #94a3b8;
      }
      .zd-tracker-btn-skip:hover {
        color: #f1f5f9;
      }
      .zd-tracker-btn-apply {
        background: #10b981;
        color: #fff;
      }
      .zd-tracker-btn-apply:hover {
        background: #059669;
      }
    `;
    document.head.appendChild(style);
  }

  function showTagToast(commentData) {
    injectToastStyles();

    // Remove any existing toast
    const existing = document.getElementById('zd-tracker-toast');
    if (existing) existing.remove();

    const selectedTags = new Set();

    const toast = document.createElement('div');
    toast.id = 'zd-tracker-toast';
    toast.className = 'zd-tracker-toast';

    const ticketTitle = commentData.ticketTitle || 'Ticket';
    const shortTitle = ticketTitle.length > 40 ? ticketTitle.substring(0, 40) + '...' : ticketTitle;

    toast.innerHTML = `
      <div class="zd-tracker-toast-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span class="zd-tracker-toast-title">Comment Captured</span>
      </div>
      <div class="zd-tracker-toast-subtitle" title="${ticketTitle}">${shortTitle}</div>
      <div class="zd-tracker-toast-tags" id="zd-tracker-tag-list"></div>
      <div class="zd-tracker-toast-actions">
        <button class="zd-tracker-btn zd-tracker-btn-skip" id="zd-tracker-skip">Skip</button>
        <button class="zd-tracker-btn zd-tracker-btn-apply" id="zd-tracker-apply">Apply Tags</button>
      </div>
    `;

    document.body.appendChild(toast);

    // Render tag buttons
    const tagList = document.getElementById('zd-tracker-tag-list');
    AVAILABLE_TAGS.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'zd-tracker-tag-btn';
      btn.textContent = tag.label;
      btn.dataset.tagId = tag.id;
      btn.addEventListener('click', () => {
        if (selectedTags.has(tag.id)) {
          selectedTags.delete(tag.id);
          btn.classList.remove('selected');
        } else {
          selectedTags.add(tag.id);
          btn.classList.add('selected');
        }
      });
      tagList.appendChild(btn);
    });

    // Auto-dismiss after 15 seconds
    let autoDismiss = setTimeout(() => dismissToast(), 15000);

    function dismissToast() {
      clearTimeout(autoDismiss);
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }

    // Skip button
    document.getElementById('zd-tracker-skip').addEventListener('click', dismissToast);

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
