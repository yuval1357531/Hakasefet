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
  };
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    return data.map(toHighlight);
  },
  async getActive() {
    return (await this.getAll()).filter((h) => h.isActive);
  },
  async create(data) {
    const all = await this.getAll();
    const order = all.length ? Math.max(...all.map((h) => h.order)) + 1 : 0;
    const { data: row, error } = await supabase
      .from('vault_highlights')
      .insert({ id: makeId('vhl'), text: data.text, order, is_active: data.isActive !== false })
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
    const { data, error } = await supabase.from('vault_highlights').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toHighlight(data);
  },
  async remove(id) {
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

export const vaultStore = {
  lessons: lessonsApi,
  highlights: highlightsApi,
};
