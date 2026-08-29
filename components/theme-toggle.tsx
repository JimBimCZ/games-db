'use client'
import { useEffect, useState } from 'react'
import { resolveTheme, type Theme } from '@/lib/theme'

function currentTheme(): Theme {
  return resolveTheme(
    localStorage.getItem('theme'),
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
}

function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem('theme', next)
  } catch {}
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setIsDark(currentTheme() === 'dark')
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setIsDark(next === 'dark')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light and dark appearance"
      aria-pressed={isDark}
      className="rounded-md border border-line px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span aria-hidden="true" className="theme-toggle-to-dark">
        Dark
      </span>
      <span aria-hidden="true" className="theme-toggle-to-light">
        Light
      </span>
    </button>
  )
}
