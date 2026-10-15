import { redirect } from 'next/navigation'

// Renders and the API moved to the developer dashboard.
export default function RendersPage() {
  redirect('/developers/dashboard#renders')
}
