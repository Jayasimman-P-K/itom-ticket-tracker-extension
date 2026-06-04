export const AVAILABLE_TAGS = [
  { id: 'session_attended', label: 'Session Attended' },
  { id: 'qppm_provided', label: 'QPPM Provided' },
  { id: 'patch_provided', label: 'Patch Provided' },
  { id: 'issue_fix_list', label: 'Issue Fix List' },
];

// Convert tag id to filename-safe string: "qppm_provided" → "QPPM-Provided"
export function tagToFilename(tagId) {
  const tag = AVAILABLE_TAGS.find(t => t.id === tagId);
  if (!tag) return tagId;
  return tag.label.replace(/\s+/g, '-');
}

// Get label from tag id
export function tagLabel(tagId) {
  const tag = AVAILABLE_TAGS.find(t => t.id === tagId);
  return tag ? tag.label : tagId;
}
