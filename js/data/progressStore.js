// User progress, now backed by the Supabase 'progress' table instead of
// localStorage. Completion is still binary (progressPercent is 0 or 100)
// -- there is no real video player yet to drive a finer-grained watch
// percentage, so don't build partial-progress logic on top of this until
// real playback tracking exists.

import { supabase } from '../supabaseClient.js';

function toRecord(row) {
  return {
    userId: row.user_id,
    lessonId: row.lesson_id,
    isCompleted: row.is_completed,
    lastWatchedAt: row.last_watched_at,
    progressPercent: row.progress_percent,
  };
}

export const progressStore = {
  async getForUser(userId) {
    const { data, error } = await supabase.from('progress').select('*').eq('user_id', userId);
    if (error || !data) return [];
    return data.map(toRecord);
  },

  async getForLesson(userId, lessonId) {
    const { data, error } = await supabase
      .from('progress')
      .select('*')
      .eq('user_id', userId)
      .eq('lesson_id', lessonId)
      .maybeSingle();
    if (error || !data) return null;
    return toRecord(data);
  },

  async toggleCompleted(userId, lessonId) {
    const existing = await this.getForLesson(userId, lessonId);
    const isCompleted = !(existing && existing.isCompleted);

    const { data, error } = await supabase
      .from('progress')
      .upsert(
        {
          user_id: userId,
          lesson_id: lessonId,
          is_completed: isCompleted,
          last_watched_at: new Date().toISOString(),
          progress_percent: isCompleted ? 100 : 0,
        },
        { onConflict: 'user_id,lesson_id' }
      )
      .select()
      .single();

    if (error || !data) {
      return { userId, lessonId, isCompleted, lastWatchedAt: Date.now(), progressPercent: isCompleted ? 100 : 0 };
    }
    return toRecord(data);
  },

  // lessons: the already-fetched Lesson[] belonging to the course (caller
  // fetches via contentStore so this store doesn't need to know about it).
  async computeCourseProgress(userId, courseId, lessons) {
    const total = lessons.length;
    if (total === 0) return { completed: 0, total: 0, percent: 0 };
    const userProgress = await this.getForUser(userId);
    const completedIds = new Set(userProgress.filter((p) => p.isCompleted).map((p) => p.lessonId));
    const completed = lessons.filter((l) => completedIds.has(l.id)).length;
    return { completed, total, percent: Math.round((completed / total) * 100) };
  },
};
