import { supabase } from './supabase.js';

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

export async function signUp(email, password, displayName) {
  const emailRedirectTo = new URL('.', window.location.href).href;
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo,
      data: { display_name: displayName.trim() }
    }
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
