import { redirect } from 'next/navigation'

/** /app/team (the link in older invitation emails): every team and invitation is on /app/teams now. */
export default function TeamLink() {
  redirect('/app/teams')
}
