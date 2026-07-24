// Data layer for the "מהישרדות לחופש" section only. Deliberately separate
// from data/contentStore.js's generic course/module/lesson library model --
// this section is a flat, linear lesson track with unlockable "messages"
// per lesson. Now backed by the Supabase 'freedom_lessons'/'freedom_messages'
// tables (moveUp/moveDown mutate the "order" column via read-then-write,
// matching the same swap logic the old localStorage version used).

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

function toMessage(row) {
  return {
    id: row.id,
    linkedLessonId: row.linked_lesson_id,
    text: row.text,
    order: row.order,
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

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Upload hardening (VibeSec): only these types, up to this size, are ever
// handed to storage -- blocks html/svg/js/executables and unbounded sizes
// regardless of what the browser's file picker allowed through. 250MB
// covers a real short phone video (a 143MB/~1:40 clip was the reported
// failure at the old 50MB cap); the 'trail-media' bucket itself now also
// carries its own file_size_limit=250MB (set directly on storage.buckets),
// so this JS check and the server-side one agree.
const ALLOWED_TRAIL_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
];
const MAX_TRAIL_MEDIA_BYTES = 250 * 1024 * 1024; // 250MB

// Strips characters that can break a storage object key/URL (#, %, ?, /, \,
// whitespace, emoji/non-ASCII) while keeping the real extension -- the
// object path never needs to show the original human filename, so this
// never needs to be reversible.
function sanitizeFileName(name) {
  const raw = String(name || 'file');
  const dot = raw.lastIndexOf('.');
  const hasExt = dot > 0 && raw.length - dot <= 8;
  const ext = hasExt ? raw.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : '';
  const base = (hasExt ? raw.slice(0, dot) : raw)
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return (base || 'file') + (ext ? '.' + ext.toLowerCase() : '');
}

// A trail note's media is a real uploaded file (image/video/document),
// stored in the now-PRIVATE 'trail-media' bucket (shared with
// vaultStore.js). The DB column keeps storing the same public-URL-shaped
// string it always has (no data migration needed for existing rows) --
// but since the bucket is no longer public, that stored string is only
// ever used as a stable KEY to derive the object path (trailMediaPath),
// never fetched directly. Actual display always goes through a
// freshly-minted signed URL (see resolveTrailMediaUrl in
// highlightsApi.getAll below), scoped by the same RLS this section's
// highlights already enforce.
//
// Returns { url, reason, message } instead of a plain url-or-null -- see
// vaultStore.js's identical function for why. `reason` is null on
// success, else one of 'invalid_type' | 'too_large' | 'upload_failed'.
async function uploadTrailMedia(file) {
  if (!file) return { url: null, reason: null };
  if (!ALLOWED_TRAIL_MEDIA_TYPES.includes(file.type)) return { url: null, reason: 'invalid_type' };
  if (file.size > MAX_TRAIL_MEDIA_BYTES) return { url: null, reason: 'too_large' };
  const path = `${makeId('trail')}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from('trail-media').upload(path, file);
  if (error) return { url: null, reason: 'upload_failed', message: error.message };
  const { data } = supabase.storage.from('trail-media').getPublicUrl(path);
  if (!data?.publicUrl) return { url: null, reason: 'upload_failed' };
  return { url: data.publicUrl, reason: null };
}

function trailMediaPath(url) {
  const marker = '/trail-media/';
  const idx = (url || '').indexOf(marker);
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length));
}

// Turns a stored (public-URL-shaped) media reference into a short-lived
// signed URL -- 10-minute expiry, matching focus-attachments/bot-knowledge's
// own signed-URL convention. Storage RLS ("trail media readable with
// section permission") re-checks this section's permission before issuing
// the signed URL.
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
  const { data } = await supabase.from('freedom_highlights').select('media_url').eq('id', id).maybeSingle();
  const path = data && trailMediaPath(data.media_url);
  if (path) await supabase.storage.from('trail-media').remove([path]);
}

async function reorder(table, id, direction, groupFilterFn) {
  const { data, error } = await supabase.from(table).select('*');
  if (error || !data) return;
  const group = data.filter(groupFilterFn).sort((a, b) => a.order - b.order);
  const idx = group.findIndex((r) => r.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= group.length) return;
  const a = group[idx];
  const b = group[swapIdx];
  await supabase.from(table).update({ order: b.order }).eq('id', a.id);
  await supabase.from(table).update({ order: a.order }).eq('id', b.id);
}

const lessonsApi = {
  async getAll() {
    const { data, error } = await supabase.from('freedom_lessons').select('*').order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toLesson);
  },
  async getActive() {
    return (await this.getAll()).filter((l) => l.isActive);
  },
  async getById(id) {
    const { data, error } = await supabase.from('freedom_lessons').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toLesson(data);
  },
  async create(data) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((l) => l.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('freedom_lessons')
      .insert({
        id: makeId('flesson'),
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
    const { data, error } = await supabase.from('freedom_lessons').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toLesson(data);
  },
  async remove(id) {
    // freedom_messages.linked_lesson_id has ON DELETE CASCADE, so deleting
    // the lesson removes its messages automatically at the DB level.
    const { error } = await supabase.from('freedom_lessons').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    await reorder('freedom_lessons', id, 'up', () => true);
  },
  async moveDown(id) {
    await reorder('freedom_lessons', id, 'down', () => true);
  },
};

const messagesApi = {
  async getAll() {
    const { data, error } = await supabase.from('freedom_messages').select('*');
    if (error || !data) return [];
    return data.map(toMessage);
  },
  async getByLessonId(lessonId) {
    const { data, error } = await supabase
      .from('freedom_messages')
      .select('*')
      .eq('linked_lesson_id', lessonId)
      .order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toMessage);
  },
  async create(data) {
    const siblings = await this.getByLessonId(data.linkedLessonId);
    const order = siblings.length ? Math.max(...siblings.map((m) => m.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('freedom_messages')
      .insert({ id: makeId('fmsg'), linked_lesson_id: data.linkedLessonId, text: data.text, order })
      .select()
      .single();
    if (error || !row) return null;
    return toMessage(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.text !== undefined) payload.text = changes.text;
    if (changes.order !== undefined) payload.order = changes.order;
    const { data, error } = await supabase.from('freedom_messages').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toMessage(data);
  },
  async remove(id) {
    const { error } = await supabase.from('freedom_messages').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    const { data: target } = await supabase.from('freedom_messages').select('*').eq('id', id).maybeSingle();
    if (!target) return;
    await reorder('freedom_messages', id, 'up', (r) => r.linked_lesson_id === target.linked_lesson_id);
  },
  async moveDown(id) {
    const { data: target } = await supabase.from('freedom_messages').select('*').eq('id', id).maybeSingle();
    if (!target) return;
    await reorder('freedom_messages', id, 'down', (r) => r.linked_lesson_id === target.linked_lesson_id);
  },
};

const highlightsApi = {
  async getAll() {
    const { data, error } = await supabase.from('freedom_highlights').select('*').order('order', { ascending: true });
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
  // Returns { ok: true, highlight } on success, or { ok: false, reason }
  // where reason is 'invalid_type' | 'too_large' | 'upload_failed' |
  // 'db_save_failed' -- see vaultStore.js's identical shape.
  async create(data) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((h) => h.order)) + 1 : 0;
    let mediaUrl = data.mediaUrl || '';
    if (data.file) {
      const uploaded = await uploadTrailMedia(data.file);
      if (!uploaded.url) return { ok: false, reason: uploaded.reason || 'upload_failed' };
      mediaUrl = uploaded.url;
    }
    const { data: row, error } = await supabase
      .from('freedom_highlights')
      .insert({
        id: makeId('fhl'),
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
    if (error || !row) {
      if (data.file && mediaUrl) {
        const path = trailMediaPath(mediaUrl);
        if (path) await supabase.storage.from('trail-media').remove([path]);
      }
      return { ok: false, reason: 'db_save_failed' };
    }
    return { ok: true, highlight: toHighlight(row) };
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
      if (!uploaded.url) return { ok: false, reason: uploaded.reason || 'upload_failed' };
      await removeTrailMediaFor(id);
      payload.media_url = uploaded.url;
    } else if (changes.mediaUrl !== undefined) {
      if (changes.mediaUrl === '') await removeTrailMediaFor(id);
      payload.media_url = changes.mediaUrl;
    }
    const { data, error } = await supabase.from('freedom_highlights').update(payload).eq('id', id).select().single();
    if (error || !data) {
      if (changes.file && payload.media_url) {
        const path = trailMediaPath(payload.media_url);
        if (path) await supabase.storage.from('trail-media').remove([path]);
      }
      return { ok: false, reason: 'db_save_failed' };
    }
    return { ok: true, highlight: toHighlight(data) };
  },
  async remove(id) {
    await removeTrailMediaFor(id);
    const { error } = await supabase.from('freedom_highlights').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    await reorder('freedom_highlights', id, 'up', () => true);
  },
  async moveDown(id) {
    await reorder('freedom_highlights', id, 'down', () => true);
  },
};

export const freedomStore = {
  lessons: lessonsApi,
  messages: messagesApi,
  highlights: highlightsApi,
};
