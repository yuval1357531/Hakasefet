'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('videos')
  const [videos, setVideos] = useState([])
  const [users, setUsers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingVideo, setEditingVideo] = useState(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    embed_code: '',
    section: 'vault',
    duration: '',
    thumbnail_url: '',
    order_num: 0,
  })

  const supabase = createClient()

  useEffect(() => {
    fetchVideos()
    fetchUsers()
  }, [])

  async function fetchVideos() {
    const { data } = await supabase
      .from('videos')
      .select('*')
      .order('section')
      .order('order_num', { ascending: true })
    if (data) setVideos(data)
  }

  async function fetchUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setUsers(data)
  }

  async function handleSaveVideo(e) {
    e.preventDefault()

    if (editingVideo) {
      await supabase
        .from('videos')
        .update(form)
        .eq('id', editingVideo.id)
    } else {
      await supabase
        .from('videos')
        .insert([form])
    }

    setForm({ title: '', description: '', embed_code: '', section: 'vault', duration: '', thumbnail_url: '', order_num: 0 })
    setShowForm(false)
    setEditingVideo(null)
    fetchVideos()
  }

  async function handleDeleteVideo(id) {
    if (confirm('למחוק את הסרטון?')) {
      await supabase.from('videos').delete().eq('id', id)
      fetchVideos()
    }
  }

  function startEdit(video) {
    setForm({
      title: video.title,
      description: video.description || '',
      embed_code: video.embed_code,
      section: video.section,
      duration: video.duration || '',
      thumbnail_url: video.thumbnail_url || '',
      order_num: video.order_num || 0,
    })
    setEditingVideo(video)
    setShowForm(true)
  }

  async function toggleCoaching(userId, current) {
    await supabase
      .from('profiles')
      .update({ has_coaching: !current })
      .eq('id', userId)
    fetchUsers()
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-vault-text mb-8">⚙️ פאנל ניהול</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('videos')}
          className={`py-2 px-5 rounded-xl font-medium transition-all ${
            activeTab === 'videos'
              ? 'bg-vault-gold text-vault-bg'
              : 'bg-vault-card text-vault-muted hover:text-vault-text'
          }`}
        >
          סרטונים ({videos.length})
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`py-2 px-5 rounded-xl font-medium transition-all ${
            activeTab === 'users'
              ? 'bg-vault-gold text-vault-bg'
              : 'bg-vault-card text-vault-muted hover:text-vault-text'
          }`}
        >
          משתמשים ({users.length})
        </button>
      </div>

      {/* Videos Tab */}
      {activeTab === 'videos' && (
        <div>
          <button
            onClick={() => { setShowForm(!showForm); setEditingVideo(null); setForm({ title: '', description: '', embed_code: '', section: 'vault', duration: '', thumbnail_url: '', order_num: 0 }) }}
            className="vault-btn mb-6"
          >
            {showForm ? 'ביטול' : '+ הוספת סרטון'}
          </button>

          {showForm && (
            <div className="vault-card mb-6">
              <h2 className="text-lg font-semibold text-vault-text mb-4">
                {editingVideo ? 'עריכת סרטון' : 'סרטון חדש'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-vault-muted text-sm mb-1">שם השיעור</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="vault-input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-vault-muted text-sm mb-1">תיאור</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="vault-input min-h-[80px]"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-vault-muted text-sm mb-1">קוד הטמעה (Embed מ-Spotlighter)</label>
                  <textarea
                    value={form.embed_code}
                    onChange={(e) => setForm({ ...form, embed_code: e.target.value })}
                    className="vault-input min-h-[80px] font-mono text-sm"
                    dir="ltr"
                    rows={3}
                    placeholder='<iframe src="..." ...></iframe>'
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-vault-muted text-sm mb-1">סקשן</label>
                    <select
                      value={form.section}
                      onChange={(e) => setForm({ ...form, section: e.target.value })}
                      className="vault-input"
                    >
                      <option value="course">מישרדות לחופש</option>
                      <option value="vault">שיעורי הכספת</option>
                      <option value="coaching">ליווי אישי</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-vault-muted text-sm mb-1">משך (לדוגמה: 45:00)</label>
                    <input
                      type="text"
                      value={form.duration}
                      onChange={(e) => setForm({ ...form, duration: e.target.value })}
                      className="vault-input"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-vault-muted text-sm mb-1">תמונה ממוזערת (URL)</label>
                    <input
                      type="text"
                      value={form.thumbnail_url}
                      onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })}
                      className="vault-input"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-vault-muted text-sm mb-1">סדר (מספר)</label>
                    <input
                      type="number"
                      value={form.order_num}
                      onChange={(e) => setForm({ ...form, order_num: parseInt(e.target.value) || 0 })}
                      className="vault-input"
                      dir="ltr"
                    />
                  </div>
                </div>
                <button onClick={handleSaveVideo} className="vault-btn">
                  {editingVideo ? 'שמירת שינויים' : 'הוספת סרטון'}
                </button>
              </div>
            </div>
          )}

          {/* Video list */}
          <div className="space-y-3">
            {videos.map((video) => (
              <div key={video.id} className="vault-card flex items-center justify-between">
                <div>
                  <span className="text-vault-muted text-sm">
                    {video.section === 'course' ? '🎯' : video.section === 'coaching' ? '⭐' : '📚'}
                  </span>
                  <span className="font-medium text-vault-text mr-2">{video.title}</span>
                  {video.duration && (
                    <span className="text-vault-muted text-sm mr-2">({video.duration})</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(video)}
                    className="text-vault-gold hover:underline text-sm"
                  >
                    עריכה
                  </button>
                  <button
                    onClick={() => handleDeleteVideo(video.id)}
                    className="text-red-400 hover:underline text-sm"
                  >
                    מחיקה
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-3">
          {users.map((user) => (
            <div key={user.id} className="vault-card flex items-center justify-between">
              <div>
                <span className="font-medium text-vault-text">{user.full_name || 'ללא שם'}</span>
                <span className="text-vault-muted text-sm mr-3" dir="ltr">{user.email}</span>
              </div>
              <button
                onClick={() => toggleCoaching(user.id, user.has_coaching)}
                className={`text-sm py-1 px-4 rounded-lg border transition-all ${
                  user.has_coaching
                    ? 'border-vault-gold text-vault-gold bg-vault-gold/10'
                    : 'border-vault-border text-vault-muted hover:border-vault-gold'
                }`}
              >
                {user.has_coaching ? '⭐ בליווי' : 'הוספה לליווי'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
