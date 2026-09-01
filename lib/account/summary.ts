export type AccountSummary = {
  displayName: string
  email: string | null
  entryCount: number
}

export function describeAccount(
  user: { name?: string | null; email: string | null },
  entryCount: number,
): AccountSummary {
  const name = user.name?.trim()
  return {
    displayName: name || user.email || 'Your account',
    email: user.email,
    entryCount,
  }
}

export function entryCountLabel(count: number): string {
  if (count === 0) return 'No library entries'
  return `${count} library ${count === 1 ? 'entry' : 'entries'}`
}
