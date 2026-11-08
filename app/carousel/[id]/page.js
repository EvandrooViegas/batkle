import { redirect } from 'next/navigation'

/** Carousels are edited in the editor, slide by slide. Old links open there, on the same slide. */
export default async function CarouselPage({ params, searchParams }) {
  const { id } = await params
  const page = (await searchParams)?.page
  redirect(`/editor/${id}${page ? `?page=${encodeURIComponent(page)}` : ''}`)
}
