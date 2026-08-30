'use server'
import { signIn, signOut } from './config.ts'

export async function signInAction() {
  await signIn('github', { redirectTo: '/' })
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' })
}
