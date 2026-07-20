// "שאלות ותשובות" on ליווי אישי's own "no access" locked screen -- a
// small, separate table (not reusing topics/highlights/etc., which are all
// scoped to real lesson content) so it's readable by ANY authenticated
// user (including one with no permission_personal_guidance at all) while
// staying admin-write-only, mirroring dailyWheelStore.sentences' own RLS
// shape exactly.

import { supabase } from '../supabaseClient.js';

function toFaq(row) {
  return { id: row.id, question: row.question, answer: row.answer, order: row.order, createdAt: row.created_at };
}

function makeId() {
  return 'pgfaq-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const personalGuidanceFaqStore = {
  async getAll() {
    const { data, error } = await supabase
      .from('personal_guidance_locked_faqs')
      .select('*')
      .order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toFaq);
  },

  async create({ question, answer }) {
    const existing = await this.getAll();
    const nextOrder = existing.length ? Math.max(...existing.map((f) => f.order)) + 1 : 0;
    const { data, error } = await supabase
      .from('personal_guidance_locked_faqs')
      .insert({ id: makeId(), question, answer, order: nextOrder })
      .select()
      .single();
    if (error || !data) return null;
    return toFaq(data);
  },

  async update(id, { question, answer }) {
    const payload = {};
    if (question !== undefined) payload.question = question;
    if (answer !== undefined) payload.answer = answer;
    const { data, error } = await supabase
      .from('personal_guidance_locked_faqs')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) return null;
    return toFaq(data);
  },

  async remove(id) {
    const { error } = await supabase.from('personal_guidance_locked_faqs').delete().eq('id', id);
    return !error;
  },

  // Same swap-with-neighbor reorder shape as every other reorderable list
  // in the app (lessons, etc.) -- `all` is the caller's already-fetched
  // full list (kept in local state), so this only needs the two rows'
  // ids/orders, no extra fetch.
  async moveUp(id, all) {
    return swapOrder(all, id, 'up');
  },
  async moveDown(id, all) {
    return swapOrder(all, id, 'down');
  },
};

async function swapOrder(all, id, direction) {
  const sorted = all.slice().sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((f) => f.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return false;
  const a = sorted[idx];
  const b = sorted[swapIdx];
  await supabase.from('personal_guidance_locked_faqs').update({ order: b.order }).eq('id', a.id);
  await supabase.from('personal_guidance_locked_faqs').update({ order: a.order }).eq('id', b.id);
  return true;
}
