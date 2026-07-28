// ============================================================
// AURA Journal — Main controller (Phase 0/1)
// Minimal end-to-end loop: auth -> load/create journal & page ->
// render one text block -> autosave -> realtime sync across devices.
//
// This intentionally does NOT yet include rich text (Quill), drawing,
// or multiple block types — those arrive in later phases. The goal
// here is a proven, synced read/write loop other blocks can build on.
// ============================================================
import { supabase } from './supabase-client.js';
import { signUpWithEmail, signInWithEmail, signInWithGoogle, signOut } from './auth.js';

const els = {
  authScreen: document.getElementById('auth-screen'),
  journalScreen: document.getElementById('journal-screen'),
  emailInput: document.getElementById('email-input'),
  passwordInput: document.getElementById('password-input'),
  signInBtn: document.getElementById('signin-btn'),
  signUpBtn: document.getElementById('signup-btn'),
  googleBtn: document.getElementById('google-btn'),
  authError: document.getElementById('auth-error'),
  signOutBtn: document.getElementById('signout-btn'),
  pageContent: document.getElementById('page-content'),
  saveStatus: document.getElementById('save-status'),
  userLabel: document.getElementById('user-label'),
};

let currentSession = null;
let currentJournalId = null;
let currentPageId = null;
let currentTextBlockId = null;
let saveTimeout = null;
let realtimeChannel = null;

// ---------- Auth screen wiring ----------
els.signInBtn.addEventListener('click', async () => {
  clearAuthError();
  try {
    await signInWithEmail(els.emailInput.value.trim(), els.passwordInput.value);
  } catch (err) {
    showAuthError(err.message);
  }
});

els.signUpBtn.addEventListener('click', async () => {
  clearAuthError();
  try {
    await signUpWithEmail(els.emailInput.value.trim(), els.passwordInput.value);
    showAuthError('Check your email to confirm your account, then sign in.', true);
  } catch (err) {
    showAuthError(err.message);
  }
});

els.googleBtn.addEventListener('click', async () => {
  clearAuthError();
  try {
    await signInWithGoogle();
  } catch (err) {
    showAuthError(err.message);
  }
});

els.signOutBtn.addEventListener('click', async () => {
  await signOut();
});

function showAuthError(message, isInfo = false) {
  els.authError.textContent = message;
  els.authError.classList.toggle('auth-error--info', isInfo);
  els.authError.hidden = false;
}

function clearAuthError() {
  els.authError.hidden = true;
}

// ---------- React to auth state changes ----------
document.addEventListener('aura:auth-changed', async (e) => {
  currentSession = e.detail.session;
  if (currentSession) {
    els.authScreen.hidden = true;
    els.journalScreen.hidden = false;
    els.userLabel.textContent = currentSession.user.email;
    await initJournal();
  } else {
    els.authScreen.hidden = false;
    els.journalScreen.hidden = true;
    teardownRealtime();
  }
});

// ---------- Journal bootstrap ----------
async function initJournal() {
  const journal = await getOrCreateDefaultJournal();
  currentJournalId = journal.id;
  const page = await getOrCreateFirstPage(currentJournalId);
  currentPageId = page.id;
  const block = await getOrCreateTextBlock(currentPageId);
  currentTextBlockId = block.id;
  els.pageContent.value = block.content?.text ?? '';
  els.pageContent.disabled = false;
  subscribeToRealtimeUpdates(currentPageId);
}

async function getOrCreateDefaultJournal() {
  const { data: existing, error: fetchErr } = await supabase
    .from('journals')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: createErr } = await supabase
    .from('journals')
    .insert({ user_id: currentSession.user.id, title: 'My Journal' })
    .select()
    .single();

  if (createErr) throw createErr;
  return created;
}

async function getOrCreateFirstPage(journalId) {
  const { data: existing, error: fetchErr } = await supabase
    .from('pages')
    .select('*')
    .eq('journal_id', journalId)
    .order('page_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: createErr } = await supabase
    .from('pages')
    .insert({ journal_id: journalId, page_number: 1 })
    .select()
    .single();

  if (createErr) throw createErr;
  return created;
}

async function getOrCreateTextBlock(pageId) {
  const { data: existing, error: fetchErr } = await supabase
    .from('blocks')
    .select('*')
    .eq('page_id', pageId)
    .eq('type', 'text')
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: createErr } = await supabase
    .from('blocks')
    .insert({ page_id: pageId, type: 'text', content: { text: '' } })
    .select()
    .single();

  if (createErr) throw createErr;
  return created;
}

// ---------- Autosave (1.5s debounce, per spec) ----------
els.pageContent.addEventListener('input', () => {
  els.saveStatus.textContent = 'Saving…';
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveTextBlock, 1500);
});

async function saveTextBlock() {
  const { error } = await supabase
    .from('blocks')
    .update({ content: { text: els.pageContent.value } })
    .eq('id', currentTextBlockId);

  els.saveStatus.textContent = error ? 'Save failed — retrying…' : 'Saved';
  if (error) {
    console.error(error);
    saveTimeout = setTimeout(saveTextBlock, 3000);
  }
}

// ---------- Realtime: reflect edits made on another device ----------
function subscribeToRealtimeUpdates(pageId) {
  teardownRealtime();
  realtimeChannel = supabase
    .channel(`blocks-page-${pageId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'blocks',
        filter: `page_id=eq.${pageId}`,
      },
      (payload) => {
        // Ignore updates that just echo what this tab already saved.
        if (document.activeElement === els.pageContent) return;
        if (payload.new.id === currentTextBlockId) {
          els.pageContent.value = payload.new.content?.text ?? '';
          els.saveStatus.textContent = 'Synced from another device';
        }
      }
    )
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
