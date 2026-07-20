// "תיק אישי" -- a student's own free-written notebook entries, backed by
// the Supabase 'personal_notebook_entries' table. Deliberately minimal
// (create + read only, no edit -- matching the "לא לבנות מחדש את כל
// המערכת" scope): a diary is written forward, not edited after the fact.
// RLS keeps a student to their own rows.

import { supabase } from '../supabaseClient.js';

function toEntry(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

function makeId() {
  return 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const notebookStore = {
  // Master-only (RLS: "admin manages notebook entries") -- every entry
  // across every student, id/studentId/createdAt only used to COUNT new
  // entries per student for the badges in studentFolders.js; never
  // rendered as a feed of its own.
  async getAll() {
    const { data, error } = await supabase
      .from('personal_notebook_entries')
      .select('id, student_id, created_at');
    if (error || !data) return [];
    return data.map((row) => ({ id: row.id, studentId: row.student_id, createdAt: row.created_at }));
  },

  async getForStudent(studentId) {
    const { data, error } = await supabase
      .from('personal_notebook_entries')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toEntry);
  },

  async create({ studentId, text }) {
    const { data, error } = await supabase
      .from('personal_notebook_entries')
      .insert({ id: makeId(), student_id: studentId, text })
      .select()
      .single();
    if (error || !data) return null;
    return toEntry(data);
  },
};
