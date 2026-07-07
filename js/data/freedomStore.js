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
  };
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    return data.map(toHighlight);
  },
  async getActive() {
    return (await this.getAll()).filter((h) => h.isActive);
  },
  async create(data) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((h) => h.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('freedom_highlights')
      .insert({ id: makeId('fhl'), text: data.text, order, is_active: data.isActive !== false })
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
    const { data, error } = await supabase.from('freedom_highlights').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toHighlight(data);
  },
  async remove(id) {
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
