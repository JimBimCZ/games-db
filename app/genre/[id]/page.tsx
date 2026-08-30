import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CardGrid } from '@/components/card-grid'
import { parseGenreId, parsePage } from '@/server/browse/params'
import { genreById, genreCards } from '@/server/browse/queries'

export default async function GenrePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const genreId = parseGenreId(id)
  if (!genreId) notFound()

  const genre = await genreById(genreId)
  if (!genre) notFound()

  const raw = (await searchParams).page
  const page = parsePage(Array.isArray(raw) ? raw[0] : raw)
  const { cards, hasNext } = await genreCards(genreId, page)

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">{genre.description}</h1>
      <CardGrid games={cards} empty="No games in this genre have been filled in yet." />
      <nav aria-label="Pagination" className="mt-6 flex gap-4">
        {page > 1 ? (
          <Link
            href={`/genre/${genreId}?page=${page - 1}`}
            className="text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link
            href={`/genre/${genreId}?page=${page + 1}`}
            className="text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Next
          </Link>
        ) : null}
      </nav>
    </div>
  )
}
