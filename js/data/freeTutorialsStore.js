// Data layer for "הדרכות חינמיות" (Master → ניהול מערכת). A FreeTutorial
// is a thin publication record over an EXISTING vault_lessons row -- it
// never copies the lesson's video/description, only references it by id
// (see uploadTrailMedia-style reasoning in vaultStore.js for why: a
// single source of truth means editing the original lesson's video later
// automatically reflects everywhere, including here).
//
// This store is only ever used from the admin screen (js/pages/freeTutorials.js),
// authenticated as the master -- reads/writes go through the normal anon
// client + RLS ("admin manages free tutorials", is_admin()-gated), the
// exact same pattern as usersStore.js. The PUBLIC "/free/<slug>" page never
// imports this file or talks to Supabase directly at all -- it only calls
// /api/free-tutorial (service-role, server-side), because RLS here has no
// anonymous-read policy on purpose.

import { supabase } from '../supabaseClient.js';

function toTutorial(row) {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    slug: row.slug,
    publicTitle: row.public_title || '',
    active: row.active,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// URL-safe slug: lowercase letters/digits/hyphens only, matching what
// free.html's own path-segment reading expects -- no encoding surprises.
export function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const freeTutorialsStore = {
  async getAll() {
    const { data, error } = await supabase.from('free_tutorials').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toTutorial);
  },

  async getById(id) {
    const { data, error } = await supabase.from('free_tutorials').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toTutorial(data);
  },

  // Client-side pre-check only -- the DB's own unique constraint on `slug`
  // is the real source of truth (see create/update's error handling below).
  async isSlugTaken(slug, excludeId) {
    const { data, error } = await supabase.from('free_tutorials').select('id').eq('slug', slug);
    if (error || !data) return false;
    return data.some((row) => row.id !== excludeId);
  },

  async create({ lessonId, slug, publicTitle, active, expiresAt }) {
    const { data, error } = await supabase
      .from('free_tutorials')
      .insert({
        id: makeId('freetut'),
        lesson_id: lessonId,
        slug,
        public_title: publicTitle || null,
        active: active !== false,
        expires_at: expiresAt || null,
      })
      .select()
      .single();
    if (error || !data) return { ok: false, reason: /duplicate key|unique/i.test(error?.message || '') ? 'slug_taken' : 'save_failed' };
    return { ok: true, tutorial: toTutorial(data) };
  },

  async update(id, changes) {
    const payload = {};
    if (changes.lessonId !== undefined) payload.lesson_id = changes.lessonId;
    if (changes.slug !== undefined) payload.slug = changes.slug;
    if (changes.publicTitle !== undefined) payload.public_title = changes.publicTitle || null;
    if (changes.active !== undefined) payload.active = changes.active;
    if (changes.expiresAt !== undefined) payload.expires_at = changes.expiresAt || null;
    payload.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('free_tutorials').update(payload).eq('id', id).select().single();
    if (error || !data) return { ok: false, reason: /duplicate key|unique/i.test(error?.message || '') ? 'slug_taken' : 'save_failed' };
    return { ok: true, tutorial: toTutorial(data) };
  },

  // Deletes only the publication record -- the linked vault_lessons row
  // (the actual lesson/video) is never touched, per its own FK having no
  // cascading effect in this direction.
  async remove(id) {
    const { error } = await supabase.from('free_tutorials').delete().eq('id', id);
    return !error;
  },
};
