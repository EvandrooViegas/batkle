'use client'

import { createContext, useContext } from 'react'

// What the Creation components call what they make: a post on Creation, a story (9:16) on Stories.
const WORDS = {
  post: { noun: 'post', Noun: 'Post', plural: 'posts', single: 'Single post', several: 'Carousel' },
  story: { noun: 'story', Noun: 'Story', plural: 'stories', single: 'One frame', several: 'Several frames' },
}

export const surfaceWords = surface => WORDS[surface] || WORDS.post
export const SurfaceContext = createContext(WORDS.post)
export const useSurfaceWords = () => useContext(SurfaceContext)
