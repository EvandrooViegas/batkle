import LegalPage, { A, Email, List, P } from '@/components/legal/LegalPage'
import { CREDIT_PACK, TRIAL } from '@/lib/billing/plans'
import { IMAGE_REFUNDS_PER_DAY } from '@/lib/billing/account'
import { LEGAL_UPDATED } from '@/lib/legal'

export const metadata = {
  title: 'Refund Policy · Batkle',
  description: 'When Batkle refunds a plan or a credit pack, how to cancel, and what happens to the credits of a post that fails.',
  icons: { icon: '/logo/batkle-icon-color.png' },
}

const sections = [
  {
    id: 'trial', title: 'Free trial',
    body: <P>The {TRIAL.days}-day trial costs nothing. Cancel before it ends, in Settings → Billing, and you are never charged.</P>,
  },
  {
    id: 'fourteen', title: 'Your first 14 days',
    body: <>
      <P>Within 14 days of paying for a plan for the first time, or of buying a credit pack, you can ask for your money back:</P>
      <List>
        <li>If you have not used any of the credits it gave you, we refund the full amount.</li>
        <li>If you have used some, we refund the share of the price that matches the credits you did not use.</li>
      </List>
      <P>This applies to monthly and yearly plans, and if your trial turned into a paid plan without you meaning it to.</P>
    </>,
  },
  {
    id: 'after', title: 'After 14 days',
    body: <P>You can cancel at any time and your plan stays active until the end of the month or year you paid for, but we do not refund the time left. Credit packs ({CREDIT_PACK.credits} credits) never expire, so you can keep using them.</P>,
  },
  {
    id: 'failed', title: 'Posts and ads that fail',
    body: <P>You do not need to ask: when a post or ad cannot be made, its credits come back to your account automatically. Once its AI images have been made, a post or ad left unfinished gets its credits back up to {IMAGE_REFUNDS_PER_DAY} times a day.</P>,
  },
  {
    id: 'problems', title: 'When something does not work',
    body: <P>If Batkle does not work as described and we cannot fix it, you are entitled to a remedy under consumer law, which can include a price reduction or a refund, whatever the date. Tell us what happened at <Email />.</P>,
  },
  {
    id: 'how', title: 'How to ask',
    body: <>
      <P>Email <Email /> from the address you sign in with, and say which payment you want refunded. We answer within 3 working days. Refunds go back to the card you paid with, through Stripe, and usually show within 5 to 10 working days.</P>
      <P>Please write to us before disputing a payment with your bank: we can usually sort it out faster.</P>
    </>,
  },
  {
    id: 'more', title: 'More',
    body: <P>Plans, renewals and cancelling are covered in the <A href="/terms">Terms of Service</A>. This policy does not limit your legal rights as a consumer.</P>,
  },
]

export default function RefundsPage() {
  return <LegalPage path="/refunds" title="Refund Policy" updated={LEGAL_UPDATED.refunds} sections={sections}
    intro="When you can get your money back, and how." />
}
