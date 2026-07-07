// Content data layer for the generic course/module/lesson library model
// (used by the jauriusBot section), now backed by Supabase tables
// (sections/courses/modules/content_lessons) instead of localStorage.
// create/update/remove are exposed for every collection so a future admin
// authoring UI can be wired in without changing the shape of this API.

import { supabase } from '../supabaseClient.js';

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Shared reorder helper: swaps `order` between the given row and its
// neighbor within the same parent scope (e.g. same section/course/module),
// mirroring the pattern in data/vaultStore.js and data/freedomStore.js.
async function reorderWithin(table, parentColumn, parentValue, id, direction) {
  const { data, error } = await supabase.from(table).select('*').eq(parentColumn, parentValue);
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

function toSection(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isActive: row.is_active,
    requiredPermission: row.required_permission,
  };
}

function toCourse(row) {
  return {
    id: row.id,
    sectionId: row.section_id,
    title: row.title,
    description: row.description,
    thumbnail: row.thumbnail,
    isActive: row.is_active,
    order: row.order,
  };
}

function toModule(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    description: row.description,
    order: row.order,
  };
}

function toLesson(row) {
  return {
    id: row.id,
    moduleId: row.module_id,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    textContent: row.text_content,
    attachments: row.attachments || [],
    duration: row.duration,
    order: row.order,
    isActive: row.is_active,
  };
}

const sectionsApi = {
  async getAll() {
    const { data, error } = await supabase.from('sections').select('*');
    if (error || !data) return [];
    return data.map(toSection);
  },
  async getById(id) {
    const { data, error } = await supabase.from('sections').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toSection(data);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.title !== undefined) payload.title = changes.title;
    if (changes.description !== undefined) payload.description = changes.description;
    if (changes.isActive !== undefined) payload.is_active = changes.isActive;
    const { data, error } = await supabase.from('sections').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toSection(data);
  },
};

const coursesApi = {
  async getAll() {
    const { data, error } = await supabase.from('courses').select('*');
    if (error || !data) return [];
    return data.map(toCourse);
  },
  async getById(id) {
    const { data, error } = await supabase.from('courses').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toCourse(data);
  },
  async getBySectionId(sectionId) {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('section_id', sectionId)
      .order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toCourse);
  },
  async getActiveBySectionId(sectionId) {
    return (await this.getBySectionId(sectionId)).filter((c) => c.isActive);
  },
  async create(data) {
    const { data: row, error } = await supabase
      .from('courses')
      .insert({
        id: makeId('course'),
        section_id: data.sectionId,
        title: data.title,
        description: data.description || '',
        thumbnail: data.thumbnail || null,
        is_active: data.isActive !== false,
        order: data.order || 0,
      })
      .select()
      .single();
    if (error || !row) return null;
    return toCourse(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.title !== undefined) payload.title = changes.title;
    if (changes.description !== undefined) payload.description = changes.description;
    if (changes.thumbnail !== undefined) payload.thumbnail = changes.thumbnail;
    if (changes.isActive !== undefined) payload.is_active = changes.isActive;
    if (changes.order !== undefined) payload.order = changes.order;
    const { data, error } = await supabase.from('courses').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toCourse(data);
  },
  async remove(id) {
    const { error } = await supabase.from('courses').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    const course = await this.getById(id);
    if (course) await reorderWithin('courses', 'section_id', course.sectionId, id, 'up');
  },
  async moveDown(id) {
    const course = await this.getById(id);
    if (course) await reorderWithin('courses', 'section_id', course.sectionId, id, 'down');
  },
};

const modulesApi = {
  async getAll() {
    const { data, error } = await supabase.from('modules').select('*');
    if (error || !data) return [];
    return data.map(toModule);
  },
  async getById(id) {
    const { data, error } = await supabase.from('modules').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toModule(data);
  },
  async getByCourseId(courseId) {
    const { data, error } = await supabase
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toModule);
  },
  async create(data) {
    const { data: row, error } = await supabase
      .from('modules')
      .insert({
        id: makeId('mod'),
        course_id: data.courseId,
        title: data.title,
        description: data.description || '',
        order: data.order || 0,
      })
      .select()
      .single();
    if (error || !row) return null;
    return toModule(row);
  },
  async update(id, changes) {
    const payload = {};
    if (changes.title !== undefined) payload.title = changes.title;
    if (changes.description !== undefined) payload.description = changes.description;
    if (changes.order !== undefined) payload.order = changes.order;
    const { data, error } = await supabase.from('modules').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toModule(data);
  },
  async remove(id) {
    const { error } = await supabase.from('modules').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    const mod = await this.getById(id);
    if (mod) await reorderWithin('modules', 'course_id', mod.courseId, id, 'up');
  },
  async moveDown(id) {
    const mod = await this.getById(id);
    if (mod) await reorderWithin('modules', 'course_id', mod.courseId, id, 'down');
  },
};

const lessonsApi = {
  async getAll() {
    const { data, error } = await supabase.from('content_lessons').select('*');
    if (error || !data) return [];
    return data.map(toLesson);
  },
  async getById(id) {
    const { data, error } = await supabase.from('content_lessons').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toLesson(data);
  },
  async getByModuleId(moduleId) {
    const { data, error } = await supabase
      .from('content_lessons')
      .select('*')
      .eq('module_id', moduleId)
      .order('order', { ascending: true });
    if (error || !data) return [];
    return data.map(toLesson);
  },
  async getActiveByModuleId(moduleId) {
    return (await this.getByModuleId(moduleId)).filter((l) => l.isActive);
  },
  async create(data) {
    const { data: row, error } = await supabase
      .from('content_lessons')
      .insert({
        id: makeId('les'),
        module_id: data.moduleId,
        title: data.title,
        description: data.description || '',
        video_url: data.videoUrl || '',
        text_content: data.textContent || '',
        attachments: data.attachments || [],
        duration: data.duration || '',
        order: data.order || 0,
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
    if (changes.videoUrl !== undefined) payload.video_url = changes.videoUrl;
    if (changes.textContent !== undefined) payload.text_content = changes.textContent;
    if (changes.attachments !== undefined) payload.attachments = changes.attachments;
    if (changes.duration !== undefined) payload.duration = changes.duration;
    if (changes.order !== undefined) payload.order = changes.order;
    if (changes.isActive !== undefined) payload.is_active = changes.isActive;
    const { data, error } = await supabase.from('content_lessons').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toLesson(data);
  },
  async remove(id) {
    const { error } = await supabase.from('content_lessons').delete().eq('id', id);
    return !error;
  },
  async moveUp(id) {
    const lesson = await this.getById(id);
    if (lesson) await reorderWithin('content_lessons', 'module_id', lesson.moduleId, id, 'up');
  },
  async moveDown(id) {
    const lesson = await this.getById(id);
    if (lesson) await reorderWithin('content_lessons', 'module_id', lesson.moduleId, id, 'down');
  },
};

export const contentStore = {
  sections: sectionsApi,
  courses: coursesApi,
  modules: modulesApi,
  lessons: lessonsApi,
};
