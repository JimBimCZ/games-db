import { signInAction } from '@/server/auth/actions'

export default function SignInPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-bg-panel p-6">
        <h1 className="text-base font-semibold">Sign in to Games</h1>
        <p className="mt-1 text-text-dim">
          Your library and wishlist are tied to your account.
        </p>
        <form action={signInAction} className="mt-5">
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-3 py-2 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </div>
  )
}
