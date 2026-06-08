// Tag categories: Logging (activity logging) and Tracking (ticket tracking)
export const TAG_CATEGORIES = [
  {
    id: 'logging',
    label: 'Logging',
    tags: [
      { id: 'session_attended', label: 'Session Attended', color: '#3b82f6' },
      { id: 'qppm_provided', label: 'QPPM Provided', color: '#8b5cf6' },
      { id: 'patch_provided', label: 'Patch Provided', color: '#f59e0b' },
      { id: 'issue_fix_list', label: 'Issue Fix List', color: '#ef4444' },
    ]
  },
  {
    id: 'tracking',
    label: 'Tracking',
    tags: [
      { id: 'newly_assigned', label: 'Newly Assigned', color: '#f97316' },
      { id: 'existing_tickets', label: 'Existing Tickets', color: '#14b8a6' },
    ]
  }
];

// Flat list of all built-in tags (for backward compat)
export const AVAILABLE_TAGS = TAG_CATEGORIES.flatMap(cat => cat.tags);

// Get all tags including custom ones from storage
export function getAllTags(customTags = []) {
  const categories = TAG_CATEGORIES.map(cat => ({
    ...cat,
    tags: [...cat.tags, ...customTags.filter(ct => ct.category === cat.id)]
  }));
  return categories;
}

// Flat list including custom
export function getAllTagsFlat(customTags = []) {
  return [...AVAILABLE_TAGS, ...customTags];
}

// Convert tag id to filename-safe string: "qppm_provided" → "QPPM-Provided"
export function tagToFilename(tagId, customTags = []) {
  const all = getAllTagsFlat(customTags);
  const tag = all.find(t => t.id === tagId);
  if (!tag) return tagId;
  return tag.label.replace(/\s+/g, '-');
}

// Get label from tag id
export function tagLabel(tagId, customTags = []) {
  const all = getAllTagsFlat(customTags);
  const tag = all.find(t => t.id === tagId);
  return tag ? tag.label : tagId;
}
