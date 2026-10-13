import { redirect } from 'next/navigation'

/** Carousels are edited in the editor, slide by slide. Old links open there, on the same slide. */
export default function CarouselPage({ params, searchParams }) {
  const page = searchParams?.page
  redirect(`/editor/${params.id}${page ? `?page=${encodeURIComponent(page)}` : ''}`)
}
