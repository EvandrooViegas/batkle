import LegalPage, { A, Email, List, P, SellerDetails } from '@/components/legal/LegalPage'
import { CREDIT_PACK, PLANS, TRIAL } from '@/lib/billing/plans'
import { IMAGE_REFUNDS_PER_DAY } from '@/lib/billing/account'
import { LEGAL_UPDATED, SELLER } from '@/lib/legal'

export const metadata = {
  title: 'Terms of Service · Batkle',
  description: 'The agreement between you and Batkle: accounts, plans, credits, your content and how disputes are handled.',
  icons: { icon: '/logo/batkle-icon-color.png' },
}

const usd = n => `$${n.toFixed(2)}`

const sections = [
  {
    id: 'who', title: 'Who we are',
    body: <>
      <P>These terms are the agreement between you and Batkle. By creating an account or using Batkle you accept them.</P>
      <SellerDetails />
    </>,
  },
  {
    id: 'account', title: 'Your account',
    body: <>
      <List>
        <li>You must be at least 16 to use Batkle, and old enough to enter a contract where you live.</li>
        <li>Give accurate details, keep your sign-in safe, and tell us at once if someone else gets into your account. You are responsible for what happens in it.</li>
        <li>If you use Batkle for a business, you confirm you may accept these terms for it.</li>
        <li>When you invite people to a brand, they work on your plan and your credits, and you are responsible for what they do there. You can change their role or remove them at any time.</li>
      </List>
    </>,
  },
  {
    id: 'service', title: 'What Batkle does',
    body: <>
      <P>Batkle reads your website and the details you give it, and drafts Instagram posts, stories, carousels and Facebook and Instagram ads for your brand, with text and images made by AI. You edit and approve everything before you use it.</P>
      <P>Batkle does not publish anything for you. You download your posts and ads and post them yourself, or upload ads in Meta Ads Manager. Reminders tell you when a scheduled post is due.</P>
    </>,
  },
  {
    id: 'plans', title: 'Plans, credits and payment',
    body: <>
      <List>
        <li>Free costs nothing and includes {PLANS.free.credits} credits a month. Pro costs {usd(PLANS.pro.price.month)} a month or {usd(PLANS.pro.price.year)} a year, Business {usd(PLANS.business.price.month)} a month or {usd(PLANS.business.price.year)} a year. Prices are in US dollars, and the price at checkout is the one you pay, with any tax shown there.</li>
        <li>One credit makes one image: a post takes one credit per slide, an ad one per image. A plan&apos;s credits renew each month and unused ones do not carry over.</li>
        <li>Extra credits come in packs of {CREDIT_PACK.credits} for {usd(CREDIT_PACK.price)}. They are used once the month&apos;s credits run out and never expire while your account exists.</li>
        <li>Payments are handled by Stripe. We never see or store your full card number.</li>
        <li>A paid plan renews automatically every month or year, and the card on file is charged at each renewal, until you cancel.</li>
        <li>If we change a price, we tell you by email at least 30 days before it applies to you, from your next renewal. You can cancel before then.</li>
      </List>
    </>,
  },
  {
    id: 'trial', title: 'Free trial',
    body: <>
      <P>Pro and Business start with a {TRIAL.days}-day free trial with {TRIAL.credits} credits, once per account. A card is needed to start it. If you do not cancel before the trial ends, the plan starts and your card is charged for the first {'month or year'} you chose. Cancel during the trial in Settings → Billing and you are not charged.</P>
    </>,
  },
  {
    id: 'cancel', title: 'Cancelling',
    body: <>
      <P>You can cancel a paid plan at any time in Settings → Billing. It stays active until the end of the period you paid for, then your account moves to Free. Your brands and posts stay, within Free&apos;s limits.</P>
      <P>Refunds are explained in the <A href="/refunds">Refund policy</A>.</P>
    </>,
  },
  {
    id: 'failed', title: 'Posts that fail',
    body: <>
      <P>If a post or ad cannot be made, its credits come back to you automatically. Once its AI images have been made, a post or ad that is left unfinished gets its credits back up to {IMAGE_REFUNDS_PER_DAY} times a day; after that its images count as used.</P>
    </>,
  },
  {
    id: 'content', title: 'Your content',
    body: <>
      <List>
        <li>You keep the rights to what you upload (your website text, logos, photos and examples) and, as far as the law allows, to the posts and ads Batkle makes for you.</li>
        <li>You give us permission to store, process and show that content only as needed to run Batkle for you, including sending it to the AI services listed in our <A href="/privacy">Privacy policy</A>. Batkle does not use your content to train AI models.</li>
        <li>Only use websites, logos, photos and other material that you own or have permission to use.</li>
      </List>
    </>,
  },
  {
    id: 'designs', title: 'Designs you share',
    body: <>
      <P>When you make one of your designs public in the Design Library, other Batkle users can see it, including its example pictures, and use its look for their own posts. You can make it private again at any time; posts already made with it are not affected. Do not share designs copied from someone else&apos;s work.</P>
    </>,
  },
  {
    id: 'ai', title: 'AI-made text and images',
    body: <>
      <List>
        <li>AI can get things wrong. Check every post and ad before you use it, especially facts, prices, offers and claims.</li>
        <li>Other people may get similar text or images, since AI models work from patterns.</li>
        <li>You are responsible for what you publish, including following Instagram&apos;s and Meta&apos;s rules and advertising standards and the laws on advertising where you sell.</li>
        <li>We do not promise any result from your posts or ads, such as followers, reach or sales.</li>
      </List>
    </>,
  },
  {
    id: 'use', title: 'Acceptable use',
    body: <>
      <P>Do not use Batkle to:</P>
      <List>
        <li>break the law, or infringe anyone&apos;s copyright, trademarks, privacy or other rights;</li>
        <li>make content that is deceptive, hateful, harassing, sexually explicit, or that impersonates someone;</li>
        <li>make ads with false or misleading claims;</li>
        <li>get around credits, plan limits or security, or reach Batkle with scripts or bots, except through the developer API;</li>
        <li>copy, resell or rebuild Batkle, or overload or disrupt it.</li>
      </List>
      <P>We may remove content or suspend an account that breaks these rules, and we tell you why unless the law or safety prevents it.</P>
    </>,
  },
  {
    id: 'api', title: 'Developer API',
    body: <>
      <P>If you use the Batkle API, keep your API keys secret: anything done with a key counts as done by you. API calls use credits as shown in the <A href="/developers">API docs</A>, and are limited in rate. We may revoke a key that is misused or leaked.</P>
    </>,
  },
  {
    id: 'availability', title: 'Availability and changes',
    body: <>
      <P>We work to keep Batkle running and your data safe, but it may sometimes be unavailable, for example during maintenance or when a service we rely on fails. We improve Batkle over time and may change or remove features; if a change takes away something important you pay for, we tell you in advance and you can cancel.</P>
    </>,
  },
  {
    id: 'ending', title: 'Suspension and ending your account',
    body: <>
      <P>You can stop using Batkle at any time and ask us to delete your account at <Email />. We may suspend or close an account that seriously or repeatedly breaks these terms, that is used for fraud, or that does not pay, after telling you where we can. What happens to your data is in our <A href="/privacy">Privacy policy</A>.</P>
    </>,
  },
  {
    id: 'liability', title: 'Liability',
    body: <>
      <P>Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, fraud, gross negligence or wilful misconduct, or your rights as a consumer.</P>
      <P>Otherwise, we are not liable for losses that were not foreseeable, for lost profits or business opportunities, or for how you use posts and ads Batkle made, and our total liability to you is limited to what you paid us in the 12 months before the claim.</P>
    </>,
  },
  {
    id: 'consumers', title: 'Your rights as a consumer',
    body: <>
      <P>If you use Batkle as a consumer, you have legal rights that these terms do not affect, including the right to a service that works as described. If something is wrong, tell us at <Email /> and we will put it right.</P>
    </>,
  },
  {
    id: 'changes', title: 'Changes to these terms',
    body: <>
      <P>We may update these terms. For changes that matter, we email you at least 30 days before they apply; if you do not agree, you can cancel before then. The date at the top shows when they last changed.</P>
    </>,
  },
  {
    id: 'law', title: 'Law and disputes',
    body: <>
      <P>These terms are governed by Portuguese law. If you are a consumer, you also keep the protection of the laws of the country where you live, and can bring a claim in its courts.</P>
      <P>Please contact us first: most problems are solved quickly by email. Consumers can also turn to an alternative dispute resolution entity; the list is at <A href="https://www.consumidor.gov.pt">consumidor.gov.pt</A>. Batkle uses the electronic complaints book, at <A href="https://www.livroreclamacoes.pt">livroreclamacoes.pt</A>.</P>
    </>,
  },
  {
    id: 'contact', title: 'Contact',
    body: <P>Questions about these terms: <Email />. {SELLER.name}, {SELLER.country}.</P>,
  },
]

export default function TermsPage() {
  return <LegalPage path="/terms" title="Terms of Service" updated={LEGAL_UPDATED.terms} sections={sections}
    intro="What you can expect from Batkle, and what Batkle expects from you." />
}
