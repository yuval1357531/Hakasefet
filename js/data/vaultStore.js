// Data layer for the "הכספת" section's lesson list. Same flat lesson
// engine shape as data/freedomStore.js's lessons API, now backed by the
// Supabase 'vault_lessons' table. Also owns the section's admin-authored
// ticker phrases ('vault_highlights'), which are blended with approved
// student comments in the top ticker (see pages/vaultSection.js).

import { supabase } from '../supabaseClient.js';

function toLesson(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    embedUrl: row.embed_url,
    hintText: row.hint_text,
    descriptionMode: row.description_mode,
    order: row.order,
    isActive: row.is_active,
  };
}

function toHighlight(row) {
  return {
    id: row.id,
    text: row.text,
    order: row.order,
    isActive: row.is_active,
    linkedLessonIds: row.linked_lesson_ids || [],
    depthLevel: row.depth_level || 'basic',
    showInTicker: row.show_in_ticker !== false,
    mediaUrl: row.media_url || '',
    description: row.description || '',
  };
}

// Lesson topics (מערכת סינון שיעורים) -- a topic just carries the array of
// lesson ids it applies to, same "linked_lesson_ids on the many side"
// shape vault_highlights already uses for its own lesson links, so no new
// join-table pattern is introduced.
function toTopic(row) {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    linkedLessonIds: row.linked_lesson_ids || [],
  };
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Upload hardening (VibeSec): only these types, up to this size, are ever
// handed to storage -- blocks html/svg/js/executables and unbounded sizes
// regardless of what the browser's file picker allowed through.
const ALLOWED_TRAIL_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
];
const MAX_TRAIL_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB

function isAllowedTrailMediaFile(file) {
  return !!file && ALLOWED_TRAIL_MEDIA_TYPES.includes(file.type) && file.size <= MAX_TRAIL_MEDIA_BYTES;
}

// A trail note's media is a real uploaded file (image/video/document),
// stored in the now-PRIVATE 'trail-media' bucket. The DB column keeps
// storing the same public-URL-shaped string it always has (so no data
// migration is needed for existing rows) -- but since the bucket is no
// longer public, that stored string is only ever used as a stable KEY to
// derive the object path (trailMediaPath), never fetched directly. Actual
// display always goes through a freshly-minted signed URL (see
// resolveTrailMediaUrl in highlightsApi.getAll below), scoped by the same
// RLS this section's highlights already enforce. Returns null (same
// contract as an actual upload error) for a disallowed type/size, so
// callers already know to treat it as a failed upload.
async function uploadTrailMedia(file) {
  if (!isAllowedTrailMediaFile(file)) return null;
  const path = `${makeId('trail')}-${file.name}`;
  const { error } = await supabase.storage.from('trail-media').upload(path, file);
  if (error) return null;
  const { data } = supabase.storage.from('trail-media').getPublicUrl(path);
  return data?.publicUrl || null;
}

function trailMediaPath(url) {
  const marker = '/trail-media/';
  const idx = (url || '').indexOf(marker);
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length));
}

// Turns a stored (public-URL-shaped) media reference into a short-lived
// signed URL -- the bucket itself is private now, so the old permanent
// public URL no longer resolves to anything on its own. 10-minute expiry,
// matching focus-attachments/bot-knowledge's own signed-URL convention.
// Storage RLS ("trail media readable with section permission") re-checks
// this exact section's permission before issuing the signed URL, so this
// is never a way to reach media the caller isn't otherwise allowed to see.
async function resolveTrailMediaUrl(url) {
  const path = trailMediaPath(url);
  if (!path) return url || '';
  const { data, error } = await supabase.storage.from('trail-media').createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return '';
  return data.signedUrl;
}

// Cleans up the storage object behind a highlight's current media before
// it's replaced or cleared, so re-uploading/removing never leaks orphaned
// files in the bucket.
async function removeTrailMediaFor(id) {
  const { data } = await supabase.from('vault_highlights').select('media_url').eq('id', id).maybeSingle();
  const path = data && trailMediaPath(data.media_url);
  if (path) await supabase.storage.from('trail-media').remove([path]);
}

async function reorder(table, id, direction) {
  const { data, error } = await supabase.from(table).select('*');
  if (error || !data) return;
  const sorted = data.slice().sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((r) => r.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx];
  const b = sorted[swapIdx];
  await supabase.from(table).update({ order: b.order }).eq('id', a.id);
  await supabase.from(table).update({ order: a.order }).eq('id', b.id);
}

const lessonsApi = {
  async getAll() {
    const { data, error } = await supabase.from('vault_lessons').select('*').order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toLesson);
  },
  async getActive() {
    return (await this.getAll()).filter((l) => l.isActive);
  },
  async getById(id) {
    const { data, error } = await supabase.from('vault_lessons').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toLesson(data);
  },
  async create(data) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((l) => l.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('vault_lessons')
      .insert({
        id: makeId('vlesson'),
        title: data.title,
        description: data.description || '',
        embed_url: data.embedUrl || '',
        hint_text: data.hintText || '',
        description_mode: data.descriptionMode || 'inline',
        order,
        is_active: data.isActive !== false,
      })
      .select()
      .single();
    if (error || !row) return null;
    return toLesson(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.title !== undefined) payload.title = changes.title;
    if (changes.description !== undefined) payload.description = changes.description;
    if (changes.embedUrl !== undefined) payload.embed_url = changes.embedUrl;
    if (changes.hintText !== undefined) payload.hint_text = changes.hintText;
    if (changes.descriptionMode !== undefined) payload.description_mode = changes.descriptionMode;
    if (changes.isActive !== undefined) payload.is_active = changes.isActive;
    if (changes.order !== undefined) payload.order = changes.order;
    const { data, error } = await supabase.from('vault_lessons').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toLesson(data);
  },
  async remove(id) {
    // comments.lesson_id has ON DELETE CASCADE, so this also removes the
    // lesson's comments at the DB level.
    const { error } = await supabase.from('vault_lessons').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    await reorder('vault_lessons', id, 'up');
  },
  async moveDown(id) {
    await reorder('vault_lessons', id, 'down');
  },
};

const highlightsApi = {
  async getAll() {
    const { data, error } = await supabase.from('vault_highlights').select('*').order('order', { ascending: true });
    if (error || !data) return [];
    const highlights = data.map(toHighlight);
    await Promise.all(
      highlights.map(async (h) => {
        if (h.mediaUrl) h.mediaUrl = await resolveTrailMediaUrl(h.mediaUrl);
      })
    );
    return highlights;
  },
  async getActive() {
    return (await this.getAll()).filter((h) => h.isActive);
  },
  async create(data) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((h) => h.order)) + 1 : 0;
    let mediaUrl = data.mediaUrl || '';
    if (data.file) {
      mediaUrl = await uploadTrailMedia(data.file);
      // Disallowed type/size or a real upload error -- reject the whole
      // create rather than silently saving the highlight without its media.
      if (!mediaUrl) return null;
    }
    const { data: row, error } = await supabase
      .from('vault_highlights')
      .insert({
        id: makeId('vhl'),
        text: data.text,
        order,
        is_active: data.isActive !== false,
        linked_lesson_ids: data.linkedLessonIds || [],
        depth_level: data.depthLevel || 'basic',
        show_in_ticker: data.showInTicker !== false,
        media_url: mediaUrl || '',
        description: data.description || '',
      })
      .select()
      .single();
    if (error || !row) return null;
    return toHighlight(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.text !== undefined) payload.text = changes.text;
    if (changes.isActive !== undefined) payload.is_active = changes.isActive;
    if (changes.order !== undefined) payload.order = changes.order;
    if (changes.linkedLessonIds !== undefined) payload.linked_lesson_ids = changes.linkedLessonIds;
    if (changes.depthLevel !== undefined) payload.depth_level = changes.depthLevel;
    if (changes.showInTicker !== undefined) payload.show_in_ticker = changes.showInTicker;
    if (changes.description !== undefined) payload.description = changes.description;
    if (changes.file) {
      const uploaded = await uploadTrailMedia(changes.file);
      // Disallowed type/size or a real upload error -- reject the whole
      // update rather than silently keeping the old media in place.
      if (!uploaded) return null;
      await removeTrailMediaFor(id);
      payload.media_url = uploaded;
    } else if (changes.mediaUrl !== undefined) {
      if (changes.mediaUrl === '') await removeTrailMediaFor(id);
      payload.media_url = changes.mediaUrl;
    }
    const { data, error } = await supabase.from('vault_highlights').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toHighlight(data);
  },
  async remove(id) {
    await removeTrailMediaFor(id);
    const { error } = await supabase.from('vault_highlights').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    await reorder('vault_highlights', id, 'up');
  },
  async moveDown(id) {
    await reorder('vault_highlights', id, 'down');
  },
};

const topicsApi = {
  async getAll() {
    const { data, error } = await supabase.from('vault_topics').select('*').order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toTopic);
  },
  async create({ name, linkedLessonIds }) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((t) => t.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('vault_topics')
      .insert({ id: makeId('vtopic'), name, order, linked_lesson_ids: linkedLessonIds || [] })
      .select()
      .single();
    if (error || !row) return null;
    return toTopic(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.name !== undefined) payload.name = changes.name;
    if (changes.linkedLessonIds !== undefined) payload.linked_lesson_ids = changes.linkedLessonIds;
    const { data, error } = await supabase.from('vault_topics').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toTopic(data);
  },
  async remove(id) {
    const { error } = await supabase.from('vault_topics').delete().eq('id', id);
    return !error;
  },
};

// Internal lesson groups/headers (חלוקה פנימית של שיעורים לכותרות) --
// same exact shape as topics (a group just carries the lesson ids under
// it, see toTopic above), so toTopic/lessonLinkRow reuse is legitimate,
// not a coincidence: it's the same "name + linked_lesson_ids" pattern,
// just a different table/purpose (fixed display grouping vs a togglable
// filter). A lesson with no group falls into the default/ungrouped
// bucket purely in the UI -- no DB flag needed for that.
const groupsApi = {
  async getAll() {
    const { data, error } = await supabase.from('vault_lesson_groups').select('*').order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toTopic);
  },
  async create({ name, linkedLessonIds }) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((g) => g.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('vault_lesson_groups')
      .insert({ id: makeId('vgroup'), name, order, linked_lesson_ids: linkedLessonIds || [] })
      .select()
      .single();
    if (error || !row) return null;
    return toTopic(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.name !== undefined) payload.name = changes.name;
    if (changes.linkedLessonIds !== undefined) payload.linked_lesson_ids = changes.linkedLessonIds;
    const { data, error } = await supabase.from('vault_lesson_groups').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toTopic(data);
  },
  async remove(id) {
    const { error } = await supabase.from('vault_lesson_groups').delete().eq('id', id);
    return !error;
  },
};

export const vaultStore = {
  lessons: lessonsApi,
  highlights: highlightsApi,
  topics: topicsApi,
  groups: groupsApi,
};
