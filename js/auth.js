import { supabase } from './supabase.js';
import { setCurrentUserCache, clearCurrentUserCache } from './database.js';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function usernameError(code) {
  const map = {
    INVALID_USERNAME: 'Use de 3 a 24 caracteres: letras minúsculas, números, ponto, hífen ou underline.',
    USERNAME_TAKEN: 'Esse usuário já está em uso.',
    INVALID_CREDENTIALS: 'Usuário ou senha inválidos.',
    WEAK_PASSWORD: 'A senha precisa ter pelo menos 6 caracteres.',
    RATE_LIMIT: 'Muitas tentativas de cadastro. Tente novamente mais tarde.',
    SIGNUP_FAILED: 'Não foi possível criar a conta agora.'
  };
  return new Error(map[code] || 'Não foi possível autenticar.');
}

async function invokeUsernameAuth(action, username, password) {
  const { data, error } = await supabase.functions.invoke('ff-username-auth', {
    body: {
      action,
      username: normalizeUsername(username),
      password: String(password || '')
    }
  });
  if (error && !data) throw new Error('Não foi possível acessar o serviço de autenticação.');
  if (!data?.ok) throw usernameError(data?.code);
  return data;
}

async function establishSessionFromResponse(data) {
  if (!data?.access_token || !data?.refresh_token) throw new Error('Sessão de autenticação inválida.');
  const sessionResult = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token
  });
  if (sessionResult.error) throw sessionResult.error;
  setCurrentUserCache(sessionResult.data?.session?.user || null);
  return { data: sessionResult.data, error: null };
}

export async function signIn(username, password) {
  const data = await invokeUsernameAuth('login', username, password);
  return establishSessionFromResponse(data);
}

export async function signUp(username, password) {
  // Cadastro e primeira autenticação acontecem na mesma chamada ao servidor.
  const data = await invokeUsernameAuth('signup', username, password);
  return establishSessionFromResponse(data);
}

export async function signOut() {
  const result = await supabase.auth.signOut();
  if (!result.error) clearCurrentUserCache();
  return result;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  setCurrentUserCache(data.session?.user || null);
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    setCurrentUserCache(session?.user || null);
    callback(session);
  });
}
