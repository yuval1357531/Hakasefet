// Knowledge-base data layer for Jaurius Bot, backed by the Supabase
// 'bot_knowledge_items' table + the private 'bot-knowledge' storage bucket
// for uploaded files. Admin-only (RLS restricts every operation to
// is_admin()) -- regular users never read this table directly; the chat
// (pages/botSection.js) reads it only while in edit mode is irrelevant,
// but the *reply* logic reads content server-side-equivalent via the same
// authenticated client, gated by the same admin-only policy, so today only
// the master's own chat can draw on it. See botSection.js for the caveat
// this implies for regular users until a real backend model is wired in.

import { supabase } from '../supabaseClient.js';

function toItem(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    fileUrl: row.file_url,
    createdAt: row.created_at,
  };
}

function makeId() {
  return 'bki-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Upload hardening (VibeSec): only these types, up to this size -- blocks
// html/svg/js/executables and unbounded sizes regardless of what the
// browser's file picker allowed through.
const ALLOWED_KNOWLEDGE_FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024; // 20MB

function isAllowedKnowledgeFile(file) {
  return ALLOWED_KNOWLEDGE_FILE_TYPES.includes(file.type) && file.size <= MAX_KNOWLEDGE_FILE_BYTES;
}

export const botKnowledgeStore = {
  async getAll() {
    const { data, error } = await supabase.from('bot_knowledge_items').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toItem);
  },

  async createText(title, content) {
    const { data, error } = await supabase
      .from('bot_knowledge_items')
      .insert({ id: makeId(), type: 'text', title, content })
      .select()
      .single();
    if (error || !data) return null;
    return toItem(data);
  },

  async createTranscript(title, content) {
    const { data, error } = await supabase
      .from('bot_knowledge_items')
      .insert({ id: makeId(), type: 'transcript', title, content })
      .select()
      .single();
    if (error || !data) return null;
    return toItem(data);
  },

  // Uploads the file to the private 'bot-knowledge' bucket and records it.
  async createFile(file) {
    if (!isAllowedKnowledgeFile(file)) return null;
    const id = makeId();
    const path = `${id}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('bot-knowledge').upload(path, file);
    if (uploadError) return null;

    const { data, error } = await supabase
      .from('bot_knowledge_items')
      .insert({ id, type: 'file', title: file.name, content: '', file_url: path })
      .select()
      .single();
    if (error || !data) return null;
    return toItem(data);
  },

  async getFileDownloadUrl(path) {
    const { data, error } = await supabase.storage.from('bot-knowledge').createSignedUrl(path, 60 * 10);
    if (error || !data) return null;
    return data.signedUrl;
  },

  async remove(item) {
    if (item.type === 'file' && item.fileUrl) {
      await supabase.storage.from('bot-knowledge').remove([item.fileUrl]);
    }
    const { error } = await supabase.from('bot_knowledge_items').delete().eq('id', item.id);
    return !error;
  },
};
