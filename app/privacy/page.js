import LegalPage, { A, Email, List, P, SellerDetails } from '@/components/legal/LegalPage'
import { LEGAL_UPDATED } from '@/lib/legal'

export const metadata = {
  title: 'Privacy Policy · Batkle',
  description: 'What Batkle collects, why, who helps process it, how long it is kept, and your rights.',
  icons: { icon: '/logo/batkle-icon-color.png' },
}

const PROCESSORS = [
  ['Clerk', 'sign-in and accounts', 'United States'],
  ['Stripe', 'payments, invoices and the billing portal', 'United States and EU'],
  ['MongoDB Atlas', 'the database', 'cloud regions chosen by Batkle'],
  ['Cloudflare R2', 'storage for images', 'global'],
  ['Vercel', 'hosting the website and app', 'United States and EU'],
  ['Resend', 'reminder and account emails', 'EU (Ireland)'],
  ['Groq', 'AI that writes text and reads brand material', 'United States'],
  ['OpenAI', 'AI images', 'United States'],
  ['fal and Pollinations', 'AI images', 'United States and EU'],
  ['Twilio', 'text reminders, once they launch', 'United States'],
]

const COOKIES = [
  ['Clerk sign-in cookies (__session, __client_uat and similar)', 'keep you signed in', 'session to 1 year', 'needed'],
  ['bk_vid', 'a random ID that counts a visit to our public pages once per half hour', '1 year', 'measurement'],
  ['bk_attr', 'the campaign or website that brought you, saved with your account when you sign up', '90 days', 'measurement'],
  ['bk_sidebar', 'whether you collapsed the app’s sidebar', '1 year', 'needed'],
]

const sections = [
  {
    id: 'who', title: 'Who is responsible',
    body: <>
      <P>This policy explains how Batkle handles personal data. The controller responsible for it is:</P>
      <SellerDetails />
    </>,
  },
  {
    id: 'collect', title: 'What we collect',
    body: <>
      <List>
        <li><strong>Your account:</strong> your name and email address, and your profile picture if you sign in with Google. Passwords are kept by Clerk; we never see them.</li>
        <li><strong>Your brands:</strong> your website address and what Batkle reads from your public website pages (text, logo, colours, fonts), the brand profile you edit, your posts, stories and ads, your ratings of them, your designs and their example pictures, photos you upload, and the images made for you.</li>
        <li><strong>People you invite</strong> to a brand: their email address and role.</li>
        <li><strong>Payments:</strong> your plan, its status and your Stripe customer number. Stripe keeps your card details; we never see the full number.</li>
        <li><strong>Reminders and emails:</strong> when your scheduled posts are due and your email preferences; a phone number only if you turn on text reminders once they launch.</li>
        <li><strong>Newsletter:</strong> your email address and when you agreed, if you sign up.</li>
        <li><strong>Visits to our public pages:</strong> the page, the website that sent you and any campaign tags, with a random visitor ID. No IP address is stored with a visit.</li>
        <li><strong>Security:</strong> our hosting keeps short-lived request logs, including IP addresses, and our request limits count requests per IP address or account for up to a day.</li>
        <li><strong>Developer API:</strong> your API keys and a record of each call (time, credits used) for 90 days.</li>
      </List>
    </>,
  },
  {
    id: 'why', title: 'Why we use it, and on what basis',
    body: <>
      <List>
        <li><strong>To provide Batkle</strong> (your account, brands, posts, reminders, teams, billing): it is necessary for our contract with you.</li>
        <li><strong>To keep Batkle secure</strong> and stop abuse, fraud and overload: our legitimate interest in a safe, working service.</li>
        <li><strong>To understand which pages and campaigns bring people to Batkle</strong>: our legitimate interest in improving it, with the cookies described below.</li>
        <li><strong>To send the newsletter and its discount code:</strong> your consent, which you can withdraw with the link in every email.</li>
        <li><strong>To keep invoices and payment records:</strong> our legal obligations under Portuguese tax law.</li>
      </List>
      <P>We do not sell your data, and we do not use it for advertising.</P>
    </>,
  },
  {
    id: 'ai', title: 'AI processing',
    body: <>
      <P>To write and design your posts, Batkle sends the material each request needs (your brand profile, the idea, your photos or examples) to the AI services listed below, and receives text and images back. Searches for stock photos send only the search words to Pexels and Unsplash.</P>
      <P>Batkle does not use your content to train AI models. Each AI service handles what it receives under its own terms and privacy policy.</P>
    </>,
  },
  {
    id: 'share', title: 'Who we share it with',
    body: <>
      <P>These services process data for us, under contracts that require them to protect it and use it only to provide their service:</P>
      <div className="overflow-x-auto rounded-xl border border-bk-line">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <thead className="bg-bk-alt text-[13px] uppercase tracking-[0.08em] text-bk-muted">
            <tr><th className="px-4 py-3 font-bold">Service</th><th className="px-4 py-3 font-bold">What for</th><th className="px-4 py-3 font-bold">Where</th></tr>
          </thead>
          <tbody>
            {PROCESSORS.map(([name, what, where]) => (
              <tr key={name} className="border-t border-bk-line"><td className="px-4 py-3 font-semibold">{name}</td><td className="px-4 py-3">{what}</td><td className="px-4 py-3 text-bk-muted">{where}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>People you invite to a brand see that brand&apos;s profile and posts. Designs you make public can be seen and used by other Batkle users. We share data with authorities only when the law requires it.</P>
    </>,
  },
  {
    id: 'transfers', title: 'Transfers outside Europe',
    body: <P>Some of these services are in the United States. Where data leaves the European Economic Area, the transfer relies on the EU–US Data Privacy Framework or on the European Commission&apos;s standard contractual clauses.</P>,
  },
  {
    id: 'keep', title: 'How long we keep it',
    body: <>
      <List>
        <li>Your account, brands, posts and images: while your account exists. Deleting a brand in Batkle removes it from your account; to have its posts and images erased as well, or your whole account, write to <Email />.</li>
        <li>When you ask us to delete your account or a brand&apos;s data, we delete it within 30 days, except what the law makes us keep.</li>
        <li>Visits to our public pages: 13 months. Developer API records: 90 days.</li>
        <li>Invoices and payment records: as long as Portuguese tax law requires (currently 10 years).</li>
        <li>Newsletter: until you unsubscribe.</li>
      </List>
    </>,
  },
  {
    id: 'rights', title: 'Your rights',
    body: <>
      <P>You can ask to see the data we hold about you, correct it, delete it, receive it in a portable format, restrict or object to how we use it, and withdraw consent you gave. Write to <Email />; we reply within one month.</P>
      <P>You can also complain to the Portuguese data protection authority, the CNPD (<A href="https://www.cnpd.pt">cnpd.pt</A>), or the authority where you live.</P>
    </>,
  },
  {
    id: 'cookies', title: 'Cookies',
    body: <>
      <P>Batkle uses a few cookies, and saves some preferences in your browser (such as the editor&apos;s snap setting and the schedule view):</P>
      <div className="overflow-x-auto rounded-xl border border-bk-line">
        <table className="w-full min-w-[560px] text-left text-[15px]">
          <thead className="bg-bk-alt text-[13px] uppercase tracking-[0.08em] text-bk-muted">
            <tr><th className="px-4 py-3 font-bold">Cookie</th><th className="px-4 py-3 font-bold">What it does</th><th className="px-4 py-3 font-bold">Kept for</th><th className="px-4 py-3 font-bold">Type</th></tr>
          </thead>
          <tbody>
            {COOKIES.map(([name, what, kept, type]) => (
              <tr key={name} className="border-t border-bk-line"><td className="px-4 py-3 font-semibold">{name}</td><td className="px-4 py-3">{what}</td><td className="px-4 py-3 text-bk-muted">{kept}</td><td className="px-4 py-3 text-bk-muted">{type}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>Clerk&apos;s sign-up check may also use Cloudflare Turnstile to tell people from bots. You can delete cookies in your browser at any time; without the sign-in cookies you cannot stay signed in.</P>
    </>,
  },
  {
    id: 'security', title: 'Security',
    body: <P>Data travels encrypted, passwords are kept by Clerk, cards by Stripe, and only the people who run Batkle can reach the database. If a breach puts your data at risk, we tell you and the CNPD as the law requires.</P>,
  },
  {
    id: 'children', title: 'Children',
    body: <P>Batkle is not meant for anyone under 16, and we do not knowingly collect their data.</P>,
  },
  {
    id: 'changes', title: 'Changes to this policy',
    body: <P>If we change how we use your data in a way that matters, we email you before the change applies. The date at the top shows when this policy last changed.</P>,
  },
  {
    id: 'contact', title: 'Contact',
    body: <P>Questions or requests about your data: <Email />.</P>,
  },
]

export default function PrivacyPage() {
  return <LegalPage path="/privacy" title="Privacy Policy" updated={LEGAL_UPDATED.privacy} sections={sections}
    intro="What Batkle collects, why, who helps us process it, how long we keep it, and your rights." />
}
