import Link from 'next/link'

const LAST_UPDATED = '1 September 2026'
const ISSUES_URL = 'https://github.com/JimBimCZ/games-db/issues'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <div className="space-y-2 text-text-dim">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="p-6">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Privacy policy</h1>
        <p className="mt-1 text-text-dim">Last updated {LAST_UPDATED}.</p>

        <Section title="What this is">
          <p>
            Games is a personal, non-commercial project that catalogues PC games using data
            from Steam. You can browse all of it without an account. Signing in exists for one
            reason: so you can keep a library of what you own, are playing, or want.
          </p>
        </Section>

        <Section title="Who is responsible">
          <p>
            The site is run by an individual, Vít Bušek, as a personal project rather than on
            behalf of a company. For anything in this policy — a question, a request for your
            data, or a complaint — open an issue at{' '}
            <a className="text-accent" href={ISSUES_URL} rel="noreferrer" target="_blank">
              github.com/JimBimCZ/games-db/issues
            </a>
            . Please do not put personal details in a public issue; ask there and you will get
            a private route to send them.
          </p>
        </Section>

        <Section title="What is stored if you sign in">
          <p>
            Signing in is handled by GitHub. When you authorise it, GitHub sends this site your
            name, your email address and the URL of your avatar, and those are stored, along
            with the access token that authorised the connection and a session record that
            keeps you signed in until it expires.
          </p>
          <p>
            Everything you then do with your library is stored against that account: which
            games you added, the status you gave each one (backlog, playing, finished,
            abandoned or wishlist), when you changed it, and — for wishlist entries — the price
            at the moment you added it, so the app can show you the change since.
          </p>
          <p>
            The legal basis is Article 6(1)(b) of the GDPR: this is the data needed to provide
            the account you asked for. Without it there is no library.
          </p>
        </Section>

        <Section title="What is not collected">
          <p>
            There is no analytics, no advertising, no tracking pixels, no profiling and no
            third-party scripts of any kind. Your browsing is not measured, and nothing about
            you is sold, shared or transferred for anyone else&apos;s purposes.
          </p>
          <p>
            Review data shown on game pages is aggregate only — score and totals. Individual
            reviews and their authors are never requested from Steam, so they are never stored
            or displayed here.
          </p>
        </Section>

        <Section title="Cookies, and why there is no cookie banner">
          <p>
            Browsing this site signed out sets no cookies at all. Cookies appear only when you
            begin signing in, and there are three: a session cookie that keeps you signed in, a
            CSRF token that stops someone else submitting forms as you, and a short-lived
            cookie remembering where to return you after GitHub. All three are set by this
            site, are unreadable to JavaScript, and are strictly necessary for a sign-in you
            explicitly asked for.
          </p>
          <p>
            Your light or dark theme choice is kept in your browser&apos;s local storage. It
            never leaves your device and is written only when you click the toggle.
          </p>
          <p>
            Consent under the ePrivacy rules is required for storage that is not strictly
            necessary — analytics and advertising, typically. Nothing here falls into that
            category, so there is nothing to ask you to consent to, and asking anyway would be
            a box to click for no purpose.
          </p>
        </Section>

        <Section title="Who else can see it">
          <p>
            The site runs on Vercel and its database is hosted by Neon; both process the data
            on this site&apos;s behalf, and Vercel&apos;s server logs will contain your IP
            address for a short period as a normal part of serving requests. GitHub sees that
            you signed in, because it is the identity provider.
          </p>
          <p>
            Game artwork and trailers are served straight from Steam&apos;s content network to
            your browser rather than being copied onto this site. That means Valve and its CDN
            provider can see your IP address and which images your browser requested. This
            happens whether or not you have an account, and it is the one third party you
            contact by using the site at all.
          </p>
        </Section>

        <Section title="How long it is kept">
          <p>
            Account and library data is kept until you delete your account, which you can do
            yourself at any time — see below. Sign-in sessions expire on their own. Server logs
            are kept for whatever period the hosting provider retains them.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Under the GDPR you can ask for a copy of your data, have it corrected, have it
            erased, object to it being processed, or ask for it in a portable form. The fastest
            route to erasure is the{' '}
            <Link className="text-accent" href="/account">
              account page
            </Link>
            , where deleting your account removes your profile, your GitHub connection, your
            sessions and every library entry immediately and permanently. For anything else,
            use the contact route above.
          </p>
          <p>
            If you think your data is being handled wrongly, you can complain to the Czech data
            protection authority, the Úřad pro ochranu osobních údajů (
            <a
              className="text-accent"
              href="https://www.uoou.cz"
              rel="noreferrer"
              target="_blank"
            >
              uoou.cz
            </a>
            ), or to the authority in your own country.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes, the date at the top changes with it. The history of this
            page is public in the repository linked above.
          </p>
        </Section>
      </div>
    </div>
  )
}
