'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const menuItems = [
  { name: 'ראשי', path: '/dashboard', icon: '🏠' },
  { name: 'מישרדות לחופש', path: '/course', icon: '🎯' },
  { name: 'שיעורי הכספת', path: '/lessons', icon: '📚' },
  { name: 'צ׳אט בוט ג׳אוריוס', path: '/chat', icon: '🤖' },
  { name: 'ליווי אישי', path: '/coaching', icon: '⭐', locked: true },
]

const adminItems = [
  { name: 'פאנל ניהול', path: '/admin', icon: '⚙️' },
]

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function navigateTo(path) {
    router.push(path)
    setIsOpen(false)
  }

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-4 right-4 z-40 md:hidden bg-vault-card border border-vault-border rounded-xl p-3 text-vault-text"
      >
        ☰
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 right-0 h-full w-72 bg-vault-card border-l border-vault-border z-50
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        md:translate-x-0 md:static md:z-auto
      `}>
        <div className="flex flex-col h-full p-6">
          {/* Brand */}
          <div className="text-center mb-8 pt-2">
            <h2 className="text-xl font-bold text-vault-gold">הכספת</h2>
            <p className="text-vault-muted text-sm mt-1">ג׳אוריוס</p>
          </div>

          {/* Close button - mobile */}
          <button
            onClick={() => setIsOpen(false)}
            className="absolute top-4 left-4 text-vault-muted hover:text-vault-text md:hidden"
          >
            ✕
          </button>

          {/* Navigation */}
          <nav className="flex-1 space-y-2">
            {menuItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigateTo(item.path)}
                className={`
                  w-full flex items-center gap-3 py-3 px-4 rounded-xl text-right transition-all
                  ${pathname === item.path
                    ? 'bg-vault-gold/10 text-vault-gold border border-vault-gold/20'
                    : 'text-vault-muted hover:text-vault-text hover:bg-vault-bg'
                  }
                  ${item.locked ? 'opacity-50' : ''}
                `}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.name}</span>
                {item.locked && <span className="mr-auto text-xs">🔒</span>}
              </button>
            ))}

            <div className="border-t border-vault-border my-4" />

            {adminItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigateTo(item.path)}
                className={`
                  w-full flex items-center gap-3 py-3 px-4 rounded-xl text-right transition-all
                  ${pathname === item.path
                    ? 'bg-vault-gold/10 text-vault-gold border border-vault-gold/20'
                    : 'text-vault-muted hover:text-vault-text hover:bg-vault-bg'
                  }
                `}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.name}</span>
              </button>
            ))}
          </nav>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 py-3 px-4 rounded-xl text-vault-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
          >
            <span>🚪</span>
            <span className="font-medium">יציאה</span>
          </button>
        </div>
      </aside>
    </>
  )
}
