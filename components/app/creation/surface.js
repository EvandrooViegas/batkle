'use client'

// What the Posts & stories components call what an idea makes: a post (4:5) or a story (9:16).
const WORDS = {
  post: { noun: 'post', Noun: 'Post', plural: 'posts', single: 'Single post', several: 'Carousel' },
  story: { noun: 'story', Noun: 'Story', plural: 'stories', single: 'One frame', several: 'Several frames' },
}

// What an idea is: a story when it was made as one (the composer's Make setting), else a post. Older ideas are posts.
export const surfaceOf = idea => (idea?.surface === 'story' ? 'story' : 'post')
export const surfaceWords = surface => WORDS[surface] || WORDS.post
/** The words for one idea: "Story ready" for a story, "Post ready" for a post. */
export const wordsFor = idea => surfaceWords(surfaceOf(idea))
