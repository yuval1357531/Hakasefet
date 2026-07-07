// Single source of truth for the dashboard's navigable sections (id/label/
// icon — presentation constants that don't change at runtime). Per-user
// visibility is controlled by permissions on the user record (see
// data/usersStore.js); section content (courses/modules/lessons) and the
// isActive/requiredPermission fields live in data/contentStore.js, seeded
// from this array's ids.
//
// Section ids double as the user.permissions object keys — keep them in
// sync if you ever add/rename a section.

export const SECTIONS = [
  {
    id: 'survivalToFreedom',
    label: 'מהישרדות לחופש',
    description: 'מרחב הניהול האישי שלך בדרך לחופש הכלכלי. התוכן המלא בבנייה.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/></svg>',
  },
  {
    id: 'vault',
    label: 'הכספת',
    description: 'האוצרות והתכנים המרכזיים של הכספת שלך.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.2"/></svg>',
  },
  {
    id: 'jauriusBot',
    label: "ג'אוריוס הבוט",
    description: 'העוזר החכם של הכספת. בקרוב תוכל לשוחח איתו ולקבל הכוונה.',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V3"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/></svg>',
  },
];

export const ADMIN_SECTION = {
  id: 'admin',
  label: 'ניהול המערכת',
  description: 'כלי ניהול למאסטר המערכת.',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15 1.65 1.65 0 0 0 3.17 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

// Only account/access management stays here as a separate operational tool.
// Content management for each section (הכספת, מהישרדות לחופש, הבוט) now
// lives inline inside that section's own page, reachable only in edit mode
// -- see vaultSection.js / freedomSection.js / botSection.js.
export const ADMIN_TOOLS = [
  {
    id: 'manage-users',
    label: 'ניהול משתמשים',
    description: 'יצירה, עריכה, חסימה ומחיקה של משתמשים, וקביעת הרשאות גישה לסקשנים.',
  },
];
