'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SEARCH_MIN } from '@/server/browse/params'

export function SearchInput() {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const typed = useRef(false)

  useEffect(() => {
    if (!typed.current) return
    const term = value.trim()
    const timer = setTimeout(() => {
      if (term.length >= SEARCH_MIN) router.push(`/search?q=${encodeURIComponent(term)}`)
    }, 250)
    return () => clearTimeout(timer)
  }, [value, router])

  return (
    <input
      type="search"
      aria-label="Search games"
      placeholder="Search"
      value={value}
      onChange={(event) => {
        typed.current = true
        setValue(event.target.value)
      }}
      className="w-48 rounded-md border border-line bg-bg px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    />
  )
}
