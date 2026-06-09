import React, { useState, useEffect } from 'react';
import { toast, ToastContainer } from 'react-toastify';
import { TAG_CATEGORIES, AVAILABLE_TAGS, getAllTags, getAllTagsFlat } from '../shared/tags.js';

function App() {
  const [captures, setCaptures] = useState([]);
  const [allCaptures, setAllCaptures] = useState({});
  const [settings, setSettings] = useState({ savePath: '', liveWriting: true, theme: 'dark' });
  const [pathInput, setPathInput] = useState('');
  const [activeTab, setActiveTab] = useState('todo');
  const [tagModal, setTagModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [statFilter, setStatFilter] = useState('7days');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [todos, setTodos] = useState([]);
  const [todoInput, setTodoInput] = useState('');
  const [customTags, setCustomTags] = useState([]);
  const [showAddTag, setShowAddTag] = useState(null); // category id or null
  const [tagStats, setTagStats] = useState({});
  const [activityStats, setActivityStats] = useState({});

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CAPTURES' }, (data) => {
      if (data) setCaptures(data);
    });
    chrome.runtime.sendMessage({ type: 'GET_ALL_CAPTURES' }, (data) => {
      if (data) setAllCaptures(data);
    });
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (data) => {
      if (data) {
        const filtered = {};
        Object.keys(data).forEach(k => { if (data[k] !== undefined) filtered[k] = data[k]; });
        setSettings(prev => ({ ...prev, ...filtered }));
        if (filtered.savePath) setPathInput(filtered.savePath);
      }
    });
    chrome.runtime.sendMessage({ type: 'GET_TODOS' }, (data) => {
      if (data) setTodos(data);
    });
    chrome.storage.local.get('customTags', (data) => {
      if (data.customTags) setCustomTags(data.customTags);
    });
    chrome.runtime.sendMessage({ type: 'GET_TAG_STATS' }, (data) => {
      if (data) setTagStats(data);
    });
    chrome.runtime.sendMessage({ type: 'GET_ACTIVITY_STATS' }, (data) => {
      if (data) setActivityStats(data);
    });

    // Live update when storage changes (new comment captured)
    const onStorageChange = (changes) => {
      if (changes.captures) {
        const allData = changes.captures.newValue || {};
        setAllCaptures(allData);
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        setCaptures(allData[todayKey] || []);
      }
      if (changes.activityStats) {
        setActivityStats(changes.activityStats.newValue || {});
      }
      if (changes.tagStats) {
        setTagStats(changes.tagStats.newValue || {});
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-theme', settings.theme || 'dark');
  }, [settings.theme]);

  const savePath = () => {
    chrome.runtime.sendMessage({ type: 'SET_SAVE_PATH', path: pathInput }, (res) => {
      if (res?.success) {
        setSettings(prev => ({ ...prev, savePath: pathInput }));
        showStatus('Path saved');
      } else {
        showStatus(res?.error || 'Failed to save path', true);
      }
    });
  };

  const toggleLiveWriting = (checked) => {
    const updated = { ...settings, liveWriting: checked };
    setSettings(updated);
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data: { liveWriting: checked } });
  };

  const toggleTheme = () => {
    const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
    const updated = { ...settings, theme: newTheme };
    setSettings(updated);
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', data: { theme: newTheme } });
  };

  const deleteCapture = (captureId) => {
    chrome.runtime.sendMessage({ type: 'DELETE_CAPTURE', commentId: captureId, dateKey: getDateKey() }, (res) => {
      if (res?.success) {
        setCaptures(prev => prev.filter(c => c.id !== captureId));
      }
    });
  };

  const showStatus = (msg, isError = false) => {
    if (isError) {
      toast.error(msg);
    } else {
      toast.success(msg);
    }
  };

  // --- Todo functions ---
  const addTodo = () => {
    const text = todoInput.trim();
    if (!text) return;
    const newTodo = { id: Date.now().toString(), text, done: false, createdAt: new Date().toISOString() };
    const updated = [newTodo, ...todos];
    setTodos(updated);
    setTodoInput('');
    chrome.runtime.sendMessage({ type: 'SAVE_TODOS', todos: updated });
  };

  const toggleTodo = (id) => {
    const updated = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTodos(updated);
    chrome.runtime.sendMessage({ type: 'SAVE_TODOS', todos: updated });
  };

  const deleteTodo = (id) => {
    const updated = todos.filter(t => t.id !== id);
    setTodos(updated);
    chrome.runtime.sendMessage({ type: 'SAVE_TODOS', todos: updated });
  };

  const openTagModal = (capture) => {
    setTagModal({
      commentId: capture.id,
      dateKey: getDateKey(),
      tags: [...(capture.tags || [])]
    });
  };

  const toggleTag = (tagId) => {
    setTagModal(prev => {
      let nextTags = [...prev.tags];

      // Tracking tags are mutually exclusive
      if (tagId === 'newly_assigned') {
        nextTags = nextTags.filter(t => t !== 'existing_tickets');
      }
      if (tagId === 'existing_tickets') {
        nextTags = nextTags.filter(t => t !== 'newly_assigned');
      }

      const tags = nextTags.includes(tagId)
        ? nextTags.filter(t => t !== tagId)
        : [...nextTags, tagId];
      return { ...prev, tags };
    });
  };

  const applyTags = () => {
    chrome.runtime.sendMessage({
      type: 'TAG_COMMENT',
      commentId: tagModal.commentId,
      dateKey: tagModal.dateKey,
      tags: tagModal.tags
    }, (res) => {
      if (res?.success) {
        setCaptures(prev => prev.map(c =>
          c.id === tagModal.commentId ? { ...c, tags: tagModal.tags } : c
        ));
        showStatus('Tags applied');
      }
      setTagModal(null);
    });
  };

  const stripHtml = (html) => {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  };

  const cleanPreview = (html) => {
    const text = stripHtml(html);
    if (!text) return '';
    const lines = text.split(/\n/).filter(l => l.trim());
    if (lines.length > 1 && /^(hi|hello|hey|dear|greetings|good\s*(morning|afternoon|evening))[,\s!]/i.test(lines[0].trim())) {
      lines.shift();
    }
    if (lines.length > 0 && /^cc[:\s,]/i.test(lines[lines.length - 1].trim())) {
      lines.pop();
    }
    return lines.join(' ').trim();
  };

  const todayFormatted = () => {
    return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const getDateKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // --- Graph data computation ---
  const getGraphData = () => {
    const now = new Date();
    let days = 7;
    if (statFilter === '1day') days = 1;
    else if (statFilter === '7days') days = 7;
    else if (statFilter === '1month') days = 30;

    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const points = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const monthKey = key.substring(0, 7);
      const persistedCount = activityStats[monthKey]?.[key] || 0;
      // Prefer persisted history for past days, keep today's live captures reactive.
      const liveCount = key === todayKey ? captures.length : (allCaptures[key] || []).length;
      const value = key === todayKey ? Math.max(persistedCount, liveCount) : Math.max(persistedCount, liveCount);
      points.push({
        date: d,
        label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        value
      });
    }
    return points;
  };

  const renderGraph = () => {
    const data = getGraphData();
    if (data.length === 0) return null;

    const maxVal = Math.max(...data.map(d => d.value), 1);
    const w = 300;
    const h = 120;
    const padX = 10;
    const padY = 15;
    const graphW = w - padX * 2;
    const graphH = h - padY * 2;

    const points = data.map((d, i) => ({
      x: padX + (i / (data.length - 1 || 1)) * graphW,
      y: padY + graphH - (d.value / maxVal) * graphH
    }));

    const pathD = points.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cpx1 = prev.x + (p.x - prev.x) * 0.4;
      const cpx2 = prev.x + (p.x - prev.x) * 0.6;
      return `C ${cpx1} ${prev.y} ${cpx2} ${p.y} ${p.x} ${p.y}`;
    }).join(' ');

    const areaD = pathD + ` L ${points[points.length - 1].x} ${h - padY} L ${points[0].x} ${h - padY} Z`;

    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h + 20}`} className="graph-svg" onMouseLeave={() => setHoveredPoint(null)}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
          <line key={i} x1={padX} x2={w - padX} y1={padY + graphH * (1 - pct)} y2={padY + graphH * (1 - pct)} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {/* Area fill */}
        <path d={areaD} fill="url(#graphGradient)" />
        {/* Line */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        {/* Gradient definition */}
        <defs>
          <linearGradient id="graphGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Hover hit areas */}
        {points.map((p, i) => (
          <rect
            key={`hit-${i}`}
            x={p.x - (graphW / data.length) / 2}
            y={0}
            width={graphW / data.length}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHoveredPoint(i)}
          />
        ))}
        {/* Labels */}
        {data.length <= 7 && data.map((d, i) => (
          <text key={i} x={points[i].x} y={h + 8} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
            {d.label}
          </text>
        ))}
        {data.length > 7 && [0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
          <text key={idx} x={points[idx].x} y={h + 8} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
            {data[idx].date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </text>
        ))}
        {/* Tooltip (rendered last = on top) */}
        {hoveredPoint !== null && (
          <g>
            <line x1={points[hoveredPoint].x} x2={points[hoveredPoint].x} y1={padY} y2={h - padY} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
            <circle cx={points[hoveredPoint].x} cy={points[hoveredPoint].y} r="5" fill="var(--accent)" stroke="var(--bg-primary)" strokeWidth="2" />
            <rect x={points[hoveredPoint].x - 18} y={Math.max(2, points[hoveredPoint].y - 28)} width="36" height="20" rx="6" fill="var(--accent)" />
            <text x={points[hoveredPoint].x} y={Math.max(15.5, points[hoveredPoint].y - 14.5)} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
              {data[hoveredPoint].value}
            </text>
          </g>
        )}
      </svg>
    );
  };

  // Tag stats from all captures in selected period
  const getTagStats = () => {
    const now = new Date();
    let days = 7;
    if (statFilter === '1day') days = 1;
    else if (statFilter === '7days') days = 7;
    else if (statFilter === '1month') days = 30;

    // Counts from live captures still in storage
    let liveCounts = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (allCaptures[key]) {
        for (const c of allCaptures[key]) {
          if (c.tags) {
            for (const tag of c.tags) {
              liveCounts[tag] = (liveCounts[tag] || 0) + 1;
            }
          }
        }
      }
    }

    // For 1-month view, also merge persisted tagStats
    let persistedCounts = {};
    if (statFilter === '1month') {
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (tagStats[monthKey]) {
        persistedCounts = { ...tagStats[monthKey] };
      }
    }

    // Order: Tracking first, then Logging
    const orderedCategories = [...TAG_CATEGORIES].sort((a, b) => {
      if (a.id === 'tracking') return -1;
      if (b.id === 'tracking') return 1;
      return 0;
    });
    const orderedTags = orderedCategories.flatMap(cat => cat.tags);
    const allTags = [...orderedTags, ...customTags];

    return allTags.map(tag => ({
      ...tag,
      count: (liveCounts[tag.id] || 0) + (persistedCounts[tag.id] || 0)
    }));
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <img src="/src/assets/icon48.png" alt="" className="header-icon" />
          <span className="header-title">Comment Tracker</span>
        </div>
        <div className="header-right">
          <div className={`live-dot ${settings.liveWriting ? 'active' : ''}`} title={settings.liveWriting ? 'Live writing ON' : 'Live writing OFF'} />
          <button className="header-btn" onClick={toggleTheme} title={settings.theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {settings.theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            )}
          </button>
          <button className="header-btn" onClick={() => setShowSettings(!showSettings)} title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </header>

      {/* Stats Hero */}
      <section className="hero">
        {activeTab === 'commented' ? (
          <div className="hero-commented">
            <p className="hero-label">desk.zoho.in</p>
            <h2 className="hero-count">{captures.length}</h2>
            <p className="hero-sublabel">comments today &middot; {todayFormatted()}</p>
          </div>
        ) : activeTab === 'statistics' ? (
          <div className="hero-stats">
            <div className="hero-graph-header">
              <div>
                <p className="hero-label">Activity</p>
                <p className="hero-sublabel">{statFilter === '7days' ? 'Last 7 days' : 'Last 30 days'}</p>
              </div>
              <div className="filter-bar-mini">
                <button className={`filter-btn-mini ${statFilter === '7days' ? 'filter-active' : ''}`} onClick={() => setStatFilter('7days')}>7D</button>
                <button className={`filter-btn-mini ${statFilter === '1month' ? 'filter-active' : ''}`} onClick={() => setStatFilter('1month')}>1M</button>
              </div>
            </div>
            <div className="graph-container">
              {renderGraph()}
            </div>
          </div>
        ) : (
          <div className="hero-commented">
            <p className="hero-label">Tasks</p>
            <h2 className="hero-count">{todos.filter(t => !t.done).length}</h2>
            <p className="hero-sublabel">{todos.filter(t => t.done).length} completed &middot; {todos.length} total</p>
          </div>
        )}
      </section>



      {/* Tab Toggle */}
      <nav className="tab-bar">
        <div className="tab-toggle tab-toggle-3">
          <button className={`tab ${activeTab === 'todo' ? 'tab-active' : ''}`} onClick={() => setActiveTab('todo')}>
            Todo
          </button>
          <button className={`tab ${activeTab === 'commented' ? 'tab-active' : ''}`} onClick={() => setActiveTab('commented')}>
            Comments
          </button>
          <button className={`tab ${activeTab === 'statistics' ? 'tab-active' : ''}`} onClick={() => setActiveTab('statistics')}>
            Statistics
          </button>
          <div className="tab-slider" style={{ transform: `translateX(${activeTab === 'todo' ? '0%' : activeTab === 'commented' ? '100%' : '200%'})` }} />
        </div>
      </nav>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'commented' && (
          <div className="content-card">
            {captures.length === 0 ? (
              <p className="empty">No comments captured today.</p>
            ) : (
              <ul className="capture-list">
                {[...captures].reverse().map((c, i) => (
                  <li key={c.id || i} className="capture-item">
                    <div className="capture-main">
                      <a className="ticket-link" href={c.url} target="_blank" rel="noopener noreferrer" title={c.url}>
                        {c.ticketTitle || (c.url ? c.url.replace(/^https?:\/\//, '').substring(0, 38) : 'Unknown ticket')}
                      </a>
                      <p className="capture-text">{cleanPreview(c.content).substring(0, 70)}</p>
                      <div className="capture-tags">
                        {(c.tags && c.tags.length > 0) ? c.tags.map(t => {
                          const tag = AVAILABLE_TAGS.find(at => at.id === t);
                          return <span key={t} className={`tag-badge tag-${t}`}>{tag?.label || t}</span>;
                        }) : <span className="tag-badge tag-none">None</span>}
                      </div>
                    </div>
                    <div className="capture-side">
                      <span className="time">{formatTime(c.commentedTime || c.capturedAt)}</span>
                      <div className="action-btns">
                        <button className="action-btn action-tag" onClick={() => openTagModal(c)} title="Tag">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                        </button>
                        <button className="action-btn action-delete" onClick={() => deleteCapture(c.id)} title="Remove">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'statistics' && (
          <div className="content-card">
            {/* Tag Stats */}
            <div className="tag-stats">
              {getTagStats().map(tag => (
                <div key={tag.id} className="stat-row">
                  <span className="stat-label">{tag.label}</span>
                  <span className="stat-value">{tag.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'todo' && (
          <div className="content-card todo-card">
            <div className="todo-input-row">
              <input
                type="text"
                className="todo-input"
                placeholder="Write a task..."
                value={todoInput}
                onChange={(e) => setTodoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
              />
              <button className="todo-add-btn" onClick={addTodo} title="Add task">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            {todos.length === 0 ? (
              <p className="empty">No tasks yet. Add one above.</p>
            ) : (
              <ul className="todo-list">
                {todos.map((todo) => (
                  <li key={todo.id} className={`todo-item ${todo.done ? 'todo-done' : ''}`}>
                    <button className="todo-checkbox" onClick={() => toggleTodo(todo.id)}>
                      {todo.done ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                      )}
                    </button>
                    <span className="todo-text">{todo.text}</span>
                    <button className="todo-delete" onClick={() => deleteTodo(todo.id)} title="Delete">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Settings Panel (overlay) */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>Settings</h3>
              <button className="header-btn" onClick={() => setShowSettings(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <label className="setting-label">Save Location</label>
            <div className="path-row">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="C:\Users\...\Documents"
              />
              <button className="btn-primary" onClick={savePath}>Set</button>
            </div>

            <div className="setting-row">
              <div>
                <span className="setting-name">Live Writing</span>
                <p className="setting-hint">Auto-save on every capture</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.liveWriting}
                  onChange={(e) => toggleLiveWriting(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="setting-row">
              <div>
                <span className="setting-name">{settings.theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                <p className="setting-hint">{settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.theme === 'light'}
                  onChange={toggleTheme}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="setting-info">
              <span className="setting-label">Output Folder</span>
              <p className="setting-path">{settings.savePath || 'Not configured'}</p>
            </div>

            <div className="setting-section">
              <span className="setting-label">Data Retention</span>
              <p className="setting-hint" style={{ marginBottom: '8px' }}>
                Comment data is auto-cleared daily at 02:00 AM. Tag statistics are retained for 1 month.
              </p>
            </div>

            <div className="setting-section">
              <span className="setting-label">Custom Tags</span>
              {TAG_CATEGORIES.map(cat => (
                <div key={cat.id} className="custom-tags-category">
                  <div className="tag-category-header">
                    <span className="tag-category-label">{cat.label}</span>
                    <button
                      className="tag-add-btn"
                      title={`Add tag to ${cat.label}`}
                      onClick={() => setShowAddTag(showAddTag === cat.id ? null : cat.id)}
                    >+</button>
                  </div>
                  {showAddTag === cat.id && (
                    <form className="add-tag-form" onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.target.elements.tagName;
                      const label = input.value.trim();
                      if (!label) return;
                      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                      const newTag = { id, label, category: cat.id };
                      const updated = [...customTags, newTag];
                      setCustomTags(updated);
                      chrome.storage.local.set({ customTags: updated });
                      setShowAddTag(null);
                    }}>
                      <input name="tagName" placeholder="Tag name..." autoFocus className="add-tag-input" />
                      <button type="submit" className="btn-primary btn-sm">Add</button>
                    </form>
                  )}
                  <div className="custom-tags-list">
                    {customTags.filter(ct => ct.category === cat.id).map(tag => (
                      <div key={tag.id} className="custom-tag-item">
                        <span>{tag.label}</span>
                        <button
                          className="custom-tag-delete"
                          onClick={() => {
                            const updated = customTags.filter(ct => ct.id !== tag.id);
                            setCustomTags(updated);
                            chrome.storage.local.set({ customTags: updated });
                          }}
                          title="Remove tag"
                        >&times;</button>
                      </div>
                    ))}
                    {customTags.filter(ct => ct.category === cat.id).length === 0 && (
                      <p className="setting-hint">No custom tags</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tag Modal */}
      {tagModal && (
        <div className="modal-overlay" onClick={() => setTagModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Tag Comment</h3>
            {TAG_CATEGORIES.map(cat => {
              const catTags = [...cat.tags, ...customTags.filter(ct => ct.category === cat.id)];
              return (
                <div key={cat.id} className="tag-category-section">
                  <div className="tag-category-header">
                    <span className="tag-category-label">{cat.label}</span>
                  </div>
                  <div className="tag-grid">
                    {catTags.map(tag => (
                      <button
                        key={tag.id}
                        className={`tag-chip ${tagModal.tags.includes(tag.id) ? 'tag-selected' : ''}`}
                        style={tag.color ? {
                          borderColor: tag.color,
                          color: tagModal.tags.includes(tag.id) ? '#fff' : tag.color,
                          background: tagModal.tags.includes(tag.id) ? tag.color : undefined
                        } : undefined}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setTagModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={applyTags}>Apply</button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme={settings.theme === 'light' ? 'light' : 'dark'}
      />
    </div>
  );
}

export default App;
