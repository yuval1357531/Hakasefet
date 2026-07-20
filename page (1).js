'use client'

export default function VideoCard({ title, description, thumbnail, duration, onClick }) {
  return (
    <button
      onClick={onClick}
      className="vault-card text-right w-full hover:border-vault-gold/40 transition-all duration-300 group"
    >
      {/* Thumbnail */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-vault-bg mb-4">
        {thumbnail ? (
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl opacity-30">▶</span>
          </div>
        )}
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-14 h-14 rounded-full bg-vault-gold/90 flex items-center justify-center">
            <span className="text-vault-bg text-xl mr-[-2px]">▶</span>
          </div>
        </div>
        {/* Duration */}
        {duration && (
          <span className="absolute bottom-2 left-2 bg-black/70 text-vault-text text-xs py-1 px-2 rounded-md">
            {duration}
          </span>
        )}
      </div>

      {/* Info */}
      <h3 className="font-semibold text-vault-text group-hover:text-vault-gold transition-colors">
        {title}
      </h3>
      {description && (
        <p className="text-vault-muted text-sm mt-1 line-clamp-2">{description}</p>
      )}
    </button>
  )
}
