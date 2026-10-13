import Editor from '@/components/editor/Editor'

export const metadata = {
  title: 'Editor · Batkle',
  icons: { icon: '/logo/batkle-icon-color.png' },
}

/** The editor for every post: single images and carousels alike. */
export default function EditorPage() {
  return <Editor />
}
