// Comment data layer for the "הכספת" section, now backed by the Supabase
// 'comments' table. A comment always starts 'pending' and only becomes
// visible to anyone but its author once an admin approves it -- enforced
// both here and by RLS server-side.

import { supabase } from '../supabaseClient.js';

function toRecord(row) {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    userId: row.user_id,
    displayName: row.display_name,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
  };
}

export const commentsStore = {
  async getAll() {
    const { data, error } = await supabase.from('comments').select('*').order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(toRecord);
  },

  async getByLessonId(lessonId) {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(toRecord);
  },

  async getApprovedByLessonId(lessonId) {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('lesson_id', lessonId)
      .eq('status', 'approved')
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(toRecord);
  },

  // All approved comments across every lesson, newest first -- feeds the
  // section-wide community ticker.
  async getApprovedAll() {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toRecord);
  },

  async create({ lessonId, userId, displayName, text }) {
    const { data, error } = await supabase
      .from('comments')
      .insert({ lesson_id: lessonId, user_id: userId, display_name: displayName, text, status: 'pending' })
      .select()
      .single();
    if (error || !data) return null;
    return toRecord(data);
  },

  async approve(id) {
    const { data, error } = await supabase.from('comments').update({ status: 'approved' }).eq('id', id).select().single();
    if (error || !data) return null;
    return toRecord(data);
  },

  async hide(id) {
    const { data, error } = await supabase.from('comments').update({ status: 'hidden' }).eq('id', id).select().single();
    if (error || !data) return null;
    return toRecord(data);
  },

  async remove(id) {
    const { error } = await supabase.from('comments').delete().eq('id', id);
    return !error;
  },

  async removeByLessonId(lessonId) {
    await supabase.from('comments').delete().eq('lesson_id', lessonId);
  },
};
