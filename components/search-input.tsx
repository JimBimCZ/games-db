'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export function SearchInput() {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')

  useEffect(() => {
    const term = value.trim()
    if (term === (params.get('q') ?? '')) return
    const timer = setTimeout(() => {
      if (term.length >= 2) router.push(`/search?q=${encodeURIComponent(term)}`)
    }, 250)
    return () => clearTimeout(timer)
  }, [value, params, router])

  return (
    <input
      type="search"
      aria-label="Search games"
      placeholder="Search"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="w-48 rounded-md border border-line bg-bg px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    />
  )
}
