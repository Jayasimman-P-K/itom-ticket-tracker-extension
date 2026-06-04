/**
 * Background Service Worker
 * - Receives captured comments from content script
 * - Stores in chrome.storage.local grouped by date
 * - Writes formatted .md files via Native Messaging Host on EVERY capture
 * - Supports hierarchical folder structure (Year-Month/)
 * - Supports per-tag category files (Year-Month/Categories/)
 */

import { AVAILABLE_TAGS, tagToFilename, tagLabel } from '../shared/tags.js';

const HOST_NAME = 'com.zoho.comment_writer';

// --- On startup: reset badge if no captures today ---
async function resetBadgeIfNewDay() {
  const today = getDateKey();
  const storage = await chrome.storage.local.get(['captures', 'lastBadgeDate']);
  const captures = storage.captures || {};
  const todayCount = (captures[today] || []).length;

  if (todayCount === 0) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeText({ text: todayCount.toString() });
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  }
  await chrome.storage.local.set({ lastBadgeDate: today });
}

// Run on service worker start
resetBadgeIfNewDay();

// Also set up an alarm to reset at midnight
chrome.alarms.create('badgeDayReset', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badgeDayReset') {
    resetBadgeIfNewDay();
  }
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COMMENT_CAPTURED') {
    handleCapture(message.data);
  }

  if (message.type === 'GET_CAPTURES') {
    getTodayCaptures().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['savePath', 'liveWriting', 'theme']).then(sendResponse);
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set(message.data).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'GET_ALL_CAPTURES') {
    chrome.storage.local.get('captures').then(s => sendResponse(s.captures || {}));
    return true;
  }

  if (message.type === 'CLEAR_TODAY') {
    clearToday().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_SAVE_PATH') {
    getSavePath().then(sendResponse);
    return true;
  }

  if (message.type === 'SET_SAVE_PATH') {
    setSavePath(message.path).then(sendResponse);
    return true;
  }

  if (message.type === 'TAG_COMMENT') {
    tagComment(message.commentId, message.dateKey, message.tags).then(sendResponse);
    return true;
  }

  if (message.type === 'DELETE_CAPTURE') {
    deleteCapture(message.commentId, message.dateKey).then(sendResponse);
    return true;
  }
});

// --- Handle a new comment capture ---
async function handleCapture(data) {
  const today = getDateKey();
  const storage = await chrome.storage.local.get('captures');
  const captures = storage.captures || {};

  if (!captures[today]) {
    captures[today] = [];
  }

  // Deduplicate by comment ID
  const exists = captures[today].some(c => c.id === data.id);
  if (exists) return;

  // Add tags field (default empty)
  data.tags = data.tags || [];

  captures[today].push(data);
  await chrome.storage.local.set({ captures });

  // Update badge with today's count
  const count = captures[today].length;
  await chrome.action.setBadgeText({ text: count.toString() });
  await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });

  // Write the daily file
  await writeDailyFile(captures[today], today);
}

// --- Tag a comment and rewrite files ---
async function tagComment(commentId, dateKey, tags) {
  const storage = await chrome.storage.local.get('captures');
  const captures = storage.captures || {};

  if (!captures[dateKey]) return { success: false, error: 'No captures for this date' };

  const entry = captures[dateKey].find(c => c.id === commentId);
  if (!entry) return { success: false, error: 'Comment not found' };

  entry.tags = tags;
  await chrome.storage.local.set({ captures });

  // Rewrite the daily file (now includes tag lines)
  await writeDailyFile(captures[dateKey], dateKey);

  // Rewrite category files for this month
  await writeCategoryFiles(dateKey, captures);

  return { success: true };
}

// --- Delete a single capture ---
async function deleteCapture(commentId, dateKey) {
  const storage = await chrome.storage.local.get('captures');
  const captures = storage.captures || {};

  if (!captures[dateKey]) return { success: false, error: 'No captures for this date' };

  captures[dateKey] = captures[dateKey].filter(c => c.id !== commentId);
  await chrome.storage.local.set({ captures });

  // Update badge
  const count = captures[dateKey].length;
  await chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });

  // Rewrite file without the deleted entry
  if (captures[dateKey].length > 0) {
    await writeDailyFile(captures[dateKey], dateKey);
  }

  return { success: true };
}

// --- Get save path (dynamic) ---
async function getSavePath() {
  const settings = await chrome.storage.local.get('savePath');
  if (settings.savePath) return { path: settings.savePath };

  const hostPath = await getSavePathFromHost();
  if (hostPath) {
    await chrome.storage.local.set({ savePath: hostPath });
    return { path: hostPath };
  }
  return { path: '' };
}

// --- Set save path (via native host) ---
async function setSavePath(newPath) {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(HOST_NAME);
      port.postMessage({ action: 'setConfig', savePath: newPath });
      port.onMessage.addListener((response) => {
        port.disconnect();
        if (response.success) {
          chrome.storage.local.set({ savePath: newPath });
          resolve({ success: true });
        } else {
          resolve({ success: false, error: response.error });
        }
      });
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        }
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

// --- Build hierarchical file path ---
// "2026-05-23" + basePath → "basePath\Ticket Tracker\2026-May\2026-05-23.md"
function buildFilePath(dateKey, basePath) {
  const d = new Date(dateKey + 'T00:00:00');
  const year = d.getFullYear();
  const monthName = d.toLocaleString('en-US', { month: 'short' });

  const monthFolder = `${year}-${monthName}`;

  return `${basePath}\\Ticket Tracker\\${monthFolder}\\${dateKey}.md`;
}

// --- Build category file path ---
function buildCategoryFilePath(dateKey, basePath, tagId) {
  const d = new Date(dateKey + 'T00:00:00');
  const year = d.getFullYear();
  const monthName = d.toLocaleString('en-US', { month: 'short' });
  const monthFolder = `${year}-${monthName}`;
  const filename = tagToFilename(tagId) + '.md';

  return `${basePath}\\Ticket Tracker\\${monthFolder}\\Categories\\${filename}`;
}

// --- Format and write the daily .txt file ---
async function writeDailyFile(entries, dateKey) {
  const settings = await chrome.storage.local.get(['savePath', 'liveWriting']);

  if (settings.liveWriting === false) return;

  let savePath = settings.savePath;
  if (!savePath) {
    savePath = await getSavePathFromHost();
    if (savePath) {
      await chrome.storage.local.set({ savePath });
    } else {
      console.error('[ZD Tracker] No save path configured');
      return;
    }
  }

  // Build formatted markdown
  const d = new Date(dateKey + 'T00:00:00');
  const dateDisplay = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [];
  lines.push(`# Commented Tickets`);
  lines.push(`**Date:** ${dateDisplay}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  entries.forEach((entry, index) => {
    const time = formatTime(entry.commentedTime || entry.capturedAt);
    const plainText = cleanComment(stripHtml(entry.content));
    const tags = entry.tags || [];
    const ticketUrl = entry.url || '';
    const ticketTitle = entry.ticketTitle || `Ticket ${index + 1}`;

    lines.push(`## ${index + 1}. [${ticketTitle}](${ticketUrl})`);
    lines.push('');
    lines.push(`**Comment Time:** ${time}`);
    lines.push('');
    lines.push(`**Comment:**`);
    lines.push(`> ${plainText.replace(/\n/g, '\n> ')}`);
    if (tags.length > 0) {
      lines.push('');
      lines.push(`**Tags:** ${tags.map(t => '`' + tagLabel(t) + '`').join(' ')}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  const content = lines.join('\r\n');
  const filePath = buildFilePath(dateKey, savePath);

  await writeToNativeHost(filePath, content);
}

// --- Write category files for a given month ---
async function writeCategoryFiles(dateKey, allCaptures) {
  const settings = await chrome.storage.local.get(['savePath', 'liveWriting']);
  if (settings.liveWriting === false) return;

  const savePath = settings.savePath;
  if (!savePath) return;

  const d = new Date(dateKey + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth();
  const monthName = d.toLocaleString('en-US', { month: 'long' });

  // Collect all captures for this month
  const monthCaptures = [];
  for (const [key, entries] of Object.entries(allCaptures)) {
    const keyDate = new Date(key + 'T00:00:00');
    if (keyDate.getFullYear() === year && keyDate.getMonth() === month) {
      entries.forEach(e => monthCaptures.push({ ...e, dateKey: key }));
    }
  }

  // Group by tag
  const tagGroups = {};
  for (const entry of monthCaptures) {
    const tags = entry.tags || [];
    for (const tag of tags) {
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(entry);
    }
  }

  // Write one file per tag (merging with existing disk data)
  for (const [tagId, tagEntries] of Object.entries(tagGroups)) {
    const label = tagLabel(tagId);
    const filePath = buildCategoryFilePath(dateKey, savePath, tagId);

    // Read existing file from disk to preserve entries from cleared days
    const existingContent = await readFromNativeHost(filePath);
    const existingEntries = parseCategoryFile(existingContent);

    // Build dedup keys for current storage entries
    const storageKeys = new Set();
    const mergedEntries = [];

    // Add all entries from current storage (these are the "source of truth" for active data)
    tagEntries.forEach(entry => {
      const entryDate = new Date(entry.dateKey + 'T00:00:00');
      const dayStr = entryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      const time = formatTime(entry.commentedTime || entry.capturedAt);
      const plainText = cleanComment(stripHtml(entry.content));
      const ticketUrl = entry.url || '';
      const ticketTitle = entry.ticketTitle || 'Ticket';
      const dedupKey = `${entry.ticketId}_${ticketUrl}_${time}`;

      storageKeys.add(dedupKey);
      mergedEntries.push({ ticketTitle, ticketUrl, dayStr, time, plainText });
    });

    // Add entries from disk that are NOT already in storage (i.e. from cleared days)
    for (const existing of existingEntries) {
      if (!storageKeys.has(existing.dedupKey)) {
        mergedEntries.push({
          ticketTitle: existing.ticketTitle,
          ticketUrl: existing.url || '',
          dayStr: existing.dateStr,
          time: existing.timeStr,
          plainText: existing.comment
        });
      }
    }

    // Write merged result
    const lines = [];
    lines.push(`# ${label}`);
    lines.push(`**Month:** ${monthName} ${year}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    mergedEntries.forEach((entry, index) => {
      lines.push(`## ${index + 1}. [${entry.ticketTitle}](${entry.ticketUrl})`);
      lines.push('');
      lines.push(`**Date:** ${entry.dayStr}`);
      lines.push(`**Comment Time:** ${entry.time}`);
      lines.push('');
      lines.push(`**Comment:**`);
      lines.push(`> ${entry.plainText.replace(/\n/g, '\n> ')}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    const content = lines.join('\r\n');
    await writeToNativeHost(filePath, content);
  }
}

// --- Read file from native host ---
function readFromNativeHost(filePath) {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(HOST_NAME);
      port.postMessage({ action: 'read', filePath: filePath });
      port.onMessage.addListener((response) => {
        port.disconnect();
        if (response.success) {
          resolve(response.content || '');
        } else {
          resolve('');
        }
      });
      port.onDisconnect.addListener(() => {
        resolve('');
      });
    } catch (e) {
      resolve('');
    }
  });
}

// --- Parse category .md file to extract comment entries ---
function parseCategoryFile(content) {
  if (!content) return [];
  const entries = [];
  // Split by ## headings (each entry starts with ## N. [Title](url))
  const sections = content.split(/^## \d+\./m).slice(1);

  for (const section of sections) {
    const entry = {};

    // Extract ticket title and URL from [Title](url)
    const titleMatch = section.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (titleMatch) {
      entry.ticketTitle = titleMatch[1];
      entry.url = titleMatch[2];
    }

    // Extract comment ID from URL (tickets/details/ID)
    const idMatch = (entry.url || '').match(/tickets\/details\/(\d+)/);
    entry.ticketId = idMatch ? idMatch[1] : '';

    // Extract date
    const dateMatch = section.match(/\*\*Date:\*\*\s*(.+)/);
    entry.dateStr = dateMatch ? dateMatch[1].trim() : '';

    // Extract comment time
    const timeMatch = section.match(/\*\*Comment Time:\*\*\s*(.+)/);
    entry.timeStr = timeMatch ? timeMatch[1].trim() : '';

    // Extract comment content (blockquote)
    const commentMatch = section.match(/\*\*Comment:\*\*\s*\n>\s*(.+?)(?=\n---|-$)/s);
    entry.comment = commentMatch ? commentMatch[1].replace(/^> /gm, '').trim() : '';

    // Use ticketId + timeStr as a dedup key
    entry.dedupKey = `${entry.ticketId}_${entry.url}_${entry.timeStr}`;

    if (entry.ticketTitle) {
      entries.push(entry);
    }
  }
  return entries;
}

// --- Send write command to native host ---
function writeToNativeHost(filePath, content) {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(HOST_NAME);

      port.postMessage({
        action: 'write',
        filePath: filePath,
        content: content
      });

      port.onMessage.addListener((response) => {
        if (response.success) {
          console.log('[ZD Tracker] File written:', response.path);
        } else {
          console.error('[ZD Tracker] Write error:', response.error);
        }
        port.disconnect();
        resolve(response);
      });

      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          console.error('[ZD Tracker] Native host error:', chrome.runtime.lastError.message);
        }
        resolve({ success: false });
      });
    } catch (e) {
      console.error('[ZD Tracker] Native messaging failed:', e.message);
      resolve({ success: false });
    }
  });
}

// --- Helpers ---

// Ask native host to read its config.json to get the save path
function getSavePathFromHost() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(HOST_NAME);
      port.postMessage({ action: 'getConfig' });
      port.onMessage.addListener((response) => {
        port.disconnect();
        resolve(response.savePath || '');
      });
      port.onDisconnect.addListener(() => {
        resolve('');
      });
    } catch (e) {
      resolve('');
    }
  });
}

function getDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Remove first line and last line if it starts with cc/CC
function cleanComment(text) {
  if (!text) return '';
  const lines = text.split('\n');
  // Remove first line
  if (lines.length > 1) {
    lines.shift();
  }
  // Remove last non-empty line if it starts with cc or CC
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') {
      if (/^cc[:\s]/i.test(lines[i].trim())) {
        lines.splice(i, 1);
      }
      break;
    }
  }
  return lines.join('\n').trim();
}

async function getTodayCaptures() {
  const today = getDateKey();
  const storage = await chrome.storage.local.get('captures');
  const captures = storage.captures || {};
  return captures[today] || [];
}

async function clearToday() {
  const today = getDateKey();
  const storage = await chrome.storage.local.get('captures');
  const captures = storage.captures || {};
  delete captures[today];
  await chrome.storage.local.set({ captures });
  await chrome.action.setBadgeText({ text: '' });
  return { success: true };
}
