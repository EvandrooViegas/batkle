import { redirect } from 'next/navigation'

// Renders and the API moved to the developer dashboard, which covers every brand of the account.
export default function BrandRendersPage() {
  redirect('/developers/dashboard#renders')
}
