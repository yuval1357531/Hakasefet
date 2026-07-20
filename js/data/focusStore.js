// "המיקוד שלך" -- personal notes/tasks the master sends students, backed by
// the Supabase 'student_focus_items' table (+ the private 'focus-attachments'
// bucket for optional file attachments). Two kinds: a 'pinned' note (no
// completion state, just stays visible) and a 'task' (student can mark it
// 'done'). A broadcast ("send to everyone") fans out into one row per
// student, sharing a broadcastId, so per-student completion still works
// exactly like a personal item -- there is no separate "global" row. RLS
// keeps a student to their own rows; only admin can create/edit/delete.

import { supabase } from '../supabaseClient.js';

function toItem(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    type: row.type,
    title: row.title,
    text: row.text,
    status: row.status,
    isImportant: row.is_important,
    broadcastId: row.broadcast_id,
    attachmentPath: row.attachment_path,
    attachmentName: row.attachment_name,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

function makeId() {
  return 'focus-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function uploadAttachment(file) {
  if (!file) return { path: null, name: null };
  const path = `${makeId()}-${file.name}`;
  const { error } = await supabase.storage.from('focus-attachments').upload(path, file);
  if (error) return { path: null, name: null };
  return { path, name: file.name };
}

export const focusStore = {
  async getForStudent(studentId) {
    const { data, error } = await supabase
      .from('student_focus_items')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toItem);
  },

  // Everything the master has ever sent, newest first -- powers the
  // master's own "recent" view (including grouping broadcast fan-out rows).
  async getSentByAdmin(limit = 100) {
    const { data, error } = await supabase
      .from('student_focus_items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(toItem);
  },

  async create({ studentId, type, title, text, isImportant, createdBy, file }) {
    const { path, name } = await uploadAttachment(file);
    const { data, error } = await supabase
      .from('student_focus_items')
      .insert({
        id: makeId(),
        student_id: studentId,
        type,
        title: title || null,
        text,
        is_important: !!isImportant,
        created_by: createdBy,
        attachment_path: path,
        attachment_name: name,
      })
      .select()
      .single();
    if (error || !data) return null;
    return toItem(data);
  },

  // Fans out into one row per student, all sharing a broadcastId, so
  // per-student completion tracking keeps working exactly like a personal
  // item -- there's no shared "global" row to update in place.
  async createBroadcast({ studentIds, type, title, text, isImportant, createdBy, file }) {
    if (!studentIds.length) return [];
    const { path, name } = await uploadAttachment(file);
    const broadcastId = 'bcast-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const rows = studentIds.map((studentId) => ({
      id: makeId(),
      student_id: studentId,
      type,
      title: title || null,
      text,
      is_important: !!isImportant,
      created_by: createdBy,
      broadcast_id: broadcastId,
      attachment_path: path,
      attachment_name: name,
    }));
    const { data, error } = await supabase.from('student_focus_items').insert(rows).select();
    if (error || !data) return [];
    return data.map(toItem);
  },

  async markDone(id) {
    const { data, error } = await supabase
      .from('student_focus_items')
      .update({ status: 'done', done_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) return null;
    return toItem(data);
  },

  async getAttachmentDownloadUrl(path) {
    const { data, error } = await supabase.storage.from('focus-attachments').createSignedUrl(path, 60 * 10);
    if (error || !data) return null;
    return data.signedUrl;
  },

  async remove(item) {
    if (item.attachmentPath) {
      await supabase.storage.from('focus-attachments').remove([item.attachmentPath]);
    }
    const { error } = await supabase.from('student_focus_items').delete().eq('id', item.id);
    return !error;
  },

  // Deletes a whole announcement group at once -- for a broadcast that's
  // every one of its per-student fan-out rows (see createBroadcast), for a
  // personal item it's just the one row. Used by the master's "לוח מודעות"
  // management view, where an announcement is deleted as a single unit
  // regardless of how many rows it's actually stored as underneath.
  async removeGroup(items) {
    if (!items.length) return true;
    const attachmentPath = items.find((i) => i.attachmentPath)?.attachmentPath;
    if (attachmentPath) {
      await supabase.storage.from('focus-attachments').remove([attachmentPath]);
    }
    const ids = items.map((i) => i.id);
    const { error } = await supabase.from('student_focus_items').delete().in('id', ids);
    return !error;
  },

  // Edits a whole announcement group at once, same "one unit regardless
  // of row count" shape as removeGroup -- a broadcast's fan-out rows all
  // get the same text/title update, so every recipient sees the edited
  // version (no separate per-recipient edit path).
  async updateGroup(items, changes) {
    if (!items.length) return false;
    const payload = {};
    if (changes.title !== undefined) payload.title = changes.title || null;
    if (changes.text !== undefined) payload.text = changes.text;
    if (changes.isImportant !== undefined) payload.is_important = !!changes.isImportant;
    const ids = items.map((i) => i.id);
    const { error } = await supabase.from('student_focus_items').update(payload).in('id', ids);
    return !error;
  },
};
