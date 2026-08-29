'use client'
import { useSyncExternalStore } from 'react'
import { resolveTheme, type Theme } from '@/lib/theme'

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Theme {
  const stored = localStorage.getItem('theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return resolveTheme(stored, prefersDark)
}

function getServerSnapshot(): Theme {
  return 'light'
}

function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem('theme', next)
  } catch {}
  listeners.forEach((listener) => listener())
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light and dark appearance"
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
