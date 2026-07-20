// "יומן אישי" -- a student's personal journal of "צידה לדרך" items they
// chose to keep, backed by the Supabase 'journal_saved_items' table. Each
// row just links a student to one highlight (vault_highlights or
// freedom_highlights, per section_id) as viewed from one specific lesson
// -- the actual content (text/media) still lives on the highlight itself,
// so the highlight is fetched separately and merged in here rather than
// duplicated into this table. RLS keeps a student to their own rows.

import { supabase } from '../supabaseClient.js';
import { vaultStore } from './vaultStore.js';
import { freedomStore } from './freedomStore.js';
import { personalGuidanceStore } from './personalGuidanceStore.js';

function toEntry(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    sectionId: row.section_id,
    highlightId: row.highlight_id,
    lessonId: row.lesson_id,
    savedAt: row.saved_at,
  };
}

export const journalStore = {
  // Raw saved-entry rows for a student, newest first -- no highlight
  // content attached yet (see getForStudentWithContent for that).
  async getForStudent(studentId) {
    const { data, error } = await supabase
      .from('journal_saved_items')
      .select('*')
      .eq('student_id', studentId)
      .order('saved_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toEntry);
  },

  // Full journal view: each saved entry joined with its highlight's own
  // text/media and the title of the lesson it was saved from. Highlights
  // and lessons live in two separate per-section tables with no bulk
  // "getByIds" today, and both are small course-content sets (not user
  // data), so this just fetches each section's full list once and matches
  // client-side rather than adding new bulk-fetch methods to those stores.
  async getForStudentWithContent(studentId) {
    const entries = await this.getForStudent(studentId);
    if (!entries.length) return [];

    const needsVault = entries.some((e) => e.sectionId === 'vault');
    const needsFreedom = entries.some((e) => e.sectionId === 'survivalToFreedom');
    const needsPersonalGuidance = entries.some((e) => e.sectionId === 'personalGuidance');
    const [vaultHighlights, freedomHighlights, pgHighlights, vaultLessons, freedomLessons, pgLessons] = await Promise.all([
      needsVault ? vaultStore.highlights.getAll() : Promise.resolve([]),
      needsFreedom ? freedomStore.highlights.getAll() : Promise.resolve([]),
      needsPersonalGuidance ? personalGuidanceStore.highlights.getAll() : Promise.resolve([]),
      needsVault ? vaultStore.lessons.getAll() : Promise.resolve([]),
      needsFreedom ? freedomStore.lessons.getAll() : Promise.resolve([]),
      needsPersonalGuidance ? personalGuidanceStore.lessons.getAll() : Promise.resolve([]),
    ]);
    const highlightById = new Map([...vaultHighlights, ...freedomHighlights, ...pgHighlights].map((h) => [h.id, h]));
    const lessonById = new Map([...vaultLessons, ...freedomLessons, ...pgLessons].map((l) => [l.id, l]));

    return entries
      .map((e) => ({
        ...e,
        highlight: highlightById.get(e.highlightId) || null,
        lessonTitle: lessonById.get(e.lessonId)?.title || null,
      }))
      .filter((e) => e.highlight);
  },

  // The set of "highlightId::lessonId" keys already saved by this student
  // -- used on a lesson page to mark which צידה לדרך items already show
  // the "saved" state, so re-clicking never creates a duplicate.
  async getSavedKeys(studentId) {
    const entries = await this.getForStudent(studentId);
    return new Set(entries.map((e) => `${e.highlightId}::${e.lessonId}`));
  },

  async save({ studentId, sectionId, highlightId, lessonId }) {
    const { data, error } = await supabase
      .from('journal_saved_items')
      .insert({ student_id: studentId, section_id: sectionId, highlight_id: highlightId, lesson_id: lessonId })
      .select()
      .maybeSingle();
    // A unique-constraint conflict (already saved) isn't a real failure --
    // treat it the same as a successful save so a double-click never
    // surfaces an error to the student.
    if (error && error.code !== '23505') return null;
    return data ? toEntry(data) : null;
  },

  async remove(id) {
    const { error } = await supabase.from('journal_saved_items').delete().eq('id', id);
    return !error;
  },
};
