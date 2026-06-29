'use client'

import { useState, useEffect } from 'react'
import VideoCard from '@/components/VideoCard'
import { createClient } from '@/lib/supabase'

export default function LessonsPage() {
  const [videos, setVideos] = useState([])
  const [selectedVideo, setSelectedVideo] = useState(null)

  useEffect(() => {
    async function fetchVideos() {
      const supabase = createClient()
      const { data } = await supabase
        .from('videos')
        .select('*')
        .eq('section', 'vault')
        .order('order_num', { ascending: true })

      if (data) setVideos(data)
    }
    fetchVideos()
  }, [])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-vault-text mb-2">📚 שיעורי הכספת</h1>
        <p className="text-vault-muted text-lg">
          כל השיעורים המוקלטים של הכספת – במקום אחד
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
          {selectedVideo.description && (
            <p className="text-vault-muted mt-2">{selectedVideo.description}</p>
          )}
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
          {videos.length > 0 ? (
            videos.map((video) => (
              <VideoCard
                key={video.id}
                title={video.title}
                description={video.description}
                thumbnail={video.thumbnail_url}
                duration={video.duration}
                onClick={() => setSelectedVideo(video)}
              />
            ))
          ) : (
            <div className="col-span-full text-center py-20">
              <p className="text-vault-muted text-lg">התוכן יעלה בקרוב...</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
