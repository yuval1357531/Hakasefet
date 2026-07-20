'use client'

import { useState, useEffect } from 'react'
import VideoCard from '@/components/VideoCard'
import { createClient } from '@/lib/supabase'

export default function CoachingPage() {
  const [hasAccess, setHasAccess] = useState(false)
  const [videos, setVideos] = useState([])
  const [selectedVideo, setSelectedVideo] = useState(null)

  useEffect(() => {
    async function checkAccess() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('has_coaching')
          .eq('id', user.id)
          .single()

        if (profile?.has_coaching) {
          setHasAccess(true)

          const { data: vids } = await supabase
            .from('videos')
            .select('*')
            .eq('section', 'coaching')
            .order('order_num', { ascending: true })

          if (vids) setVideos(vids)
        }
      }
    }
    checkAccess()
  }, [])

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-6xl mb-6">🔒</div>
        <h1 className="text-3xl font-bold text-vault-text mb-3">ליווי אישי</h1>
        <p className="text-vault-muted text-lg max-w-md mb-8">
          האזור הזה פתוח רק למי שנמצא בליווי האישי עם ג׳אוריוס.
          כאן תמצא קייס סטאדי, סרטונים ייחודיים, וכלים מתקדמים.
        </p>
        <a
          href="https://wa.me/YOUR_NUMBER"
          target="_blank"
          className="vault-btn-outline"
        >
          רוצה לשמוע על הליווי? דבר איתי
        </a>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-vault-text mb-2">⭐ ליווי אישי</h1>
        <p className="text-vault-muted text-lg">
          התוכן והכלים המתקדמים של הליווי האישי
        </p>
      </div>

      {selectedVideo && (
        <div className="vault-card mb-8">
          <div className="aspect-video rounded-xl overflow-hidden bg-black mb-4">
            <div
              dangerouslySetInnerHTML={{ __html: selectedVideo.embed_code }}
              className="w-full h-full"
            />
          </div>
          <h2 className="text-xl font-semibold text-vault-text">{selectedVideo.title}</h2>
          <button
            onClick={() => setSelectedVideo(null)}
            className="text-vault-gold text-sm mt-4 hover:underline"
          >
            ← חזרה לרשימה
          </button>
        </div>
      )}

      {!selectedVideo && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              title={video.title}
              description={video.description}
              thumbnail={video.thumbnail_url}
              duration={video.duration}
              onClick={() => setSelectedVideo(video)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
