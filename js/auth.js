import { supabase } from './supabase-client.js';

export async function signUpWithEmail(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
}

export async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('aura:auth-changed', { detail: { session: data.session } }));
    return data;
}

export async function signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) throw error;
    return data;
}

export async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
}
