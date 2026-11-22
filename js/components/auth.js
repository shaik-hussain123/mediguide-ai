/**
 * @file Login / register / profile (FR-8, SRS §8.1–8.2, §12.3).
 * Two modes: SERVER (JWT + HttpOnly refresh cookie, TOTP 2FA, OAuth2, ABHA link) when the Node server answers,
 * and LOCAL (browser-only demo accounts, PBKDF2) otherwise. Client-side roles are never a security boundary.
 */
import { $, escapeHtml as h, formatDate, hashPassword, randomHex, uid, showToast, openModal, closeModal } from '../utils/helpers.js';
import { verifyTotp } from '../utils/totp.js';
import { normaliseAbhaNumber, normaliseAbhaAddress } from '../utils/abha.js';
import * as backend from '../services/backend.js';
import * as store from '../utils/storage.js';
import * as audit from '../utils/audit.js';
import { currentLang, setLang } from '../i18n.js';
import { KEYS, ADMIN_EMAILS } from '../config.js';

const listeners = new Set();
export const onAuthChange = (fn) => { listeners.add(fn); fn(currentUser()); };
const emit = () => listeners.forEach((fn) => fn(currentUser()));

const users = () => store.get(KEYS.users, []);
const saveUsers = (list) => store.set(KEYS.users, list);
const localUser = () => { const s = store.get(KEYS.session, null); return s ? users().find((u) => u.id === s.userId) || null : null; };

export const serverMode = () => backend.isOnline();
export const currentUser = () => (serverMode() ? backend.getUser() : localUser());
export const loginTime = () => (serverMode() ? backend.getLoginAt() : store.get(KEYS.session, null)?.loginAt) || null;
export const isAdmin = (u = currentUser()) => u?.role === 'admin';
export const allUsers = () => users().map(({ id, name, email, role, created }) => ({ id, name, email, role, created }));

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const fails = new Map();
const throttled = (email) => { const f = fails.get(email); return f && f.count >= 5 && Date.now() - f.last < 60000; };

function checkRegister({ name, email, password, consent }) {
  name = String(name || '').trim().slice(0, 80); email = String(email || '').trim().toLowerCase();
  if (name.length < 2) throw new Error('Please enter your full name.');
  if (!EMAIL_RE.test(email)) throw new Error('Please enter a valid email address.');
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.');
  if (!consent) throw new Error('Please tick the box to confirm you understand this is informational only.');
  return { name, email };
}

export async function register(input) {
  const { name, email } = checkRegister(input);
  if (serverMode()) { const u = await backend.register(name, email, input.password); audit.log('register', 'server'); emit(); return u; }
  if (users().some((u) => u.email === email)) throw new Error('An account with this email already exists. Please log in.');
  const salt = randomHex(16);
  const user = {
    id: uid(), name, email, salt, hash: await hashPassword(input.password, salt),
    role: ADMIN_EMAILS.includes(email) ? 'admin' : 'user', created: new Date().toISOString(),
    totpSecret: null, profile: { age: '', weight: '', conditions: '', allergies: '' }, abha: { number: '', address: '' },
  };
  saveUsers([...users(), user]);
  store.set(KEYS.session, { userId: user.id, loginAt: new Date().toISOString() });
  audit.log('register', user.role); emit(); return user;
}

export async function login({ email, password, totp }) {
  email = String(email || '').trim().toLowerCase();
  if (serverMode()) { const u = await backend.login(email, password, totp); emit(); return u; }
  if (throttled(email)) throw new Error('Too many attempts. Please wait a minute and try again.');
  const user = users().find((u) => u.email === email);
  const ok = user && (await hashPassword(String(password || ''), user.salt)) === user.hash;
  if (!ok) { const f = fails.get(email) || { count: 0 }; fails.set(email, { count: f.count + 1, last: Date.now() }); audit.log('login_failed'); throw new Error('Email or password is incorrect.'); }
  if (user.totpSecret && !(await verifyTotp(user.totpSecret, String(totp || '').trim()))) { audit.log('login_2fa_failed'); throw new Error('Enter the 6-digit code from your authenticator app.'); }
  fails.delete(email);
  store.set(KEYS.session, { userId: user.id, loginAt: new Date().toISOString() });
  audit.log('login'); emit(); return user;
}

export async function logout() {
  if (serverMode()) await backend.logout(); else { audit.log('logout'); store.remove(KEYS.session); }
  emit();
}

export async function updateProfile(patch) {
  const u = currentUser();
  if (!u) throw new Error('Please log in first.');
  const age = patch.age === '' ? '' : Number(patch.age);
  const weight = patch.weight === '' ? '' : Number(patch.weight);
  if (age !== '' && !(age >= 1 && age <= 120)) throw new Error('Age must be between 1 and 120.');
  if (weight !== '' && !(weight >= 1 && weight <= 300)) throw new Error('Weight must be between 1 and 300 kg.');
  const abha = { number: normaliseAbhaNumber(patch.abhaNumber), address: normaliseAbhaAddress(patch.abhaAddress) };
  const profile = { age, weight, conditions: String(patch.conditions || '').trim().slice(0, 200), allergies: String(patch.allergies || '').trim().slice(0, 200) };
  if (serverMode()) {
    const { user } = await backend.api('/api/profile', { method: 'PUT', body: { ...profile, lang: currentLang(), abha } });
    backend.setUser(user);
  } else {
    saveUsers(users().map((x) => (x.id === u.id ? { ...x, profile, abha } : x)));
    audit.log('profile_updated');
  }
  emit();
}

/* ------------------------------ 2FA (server mode) ------------------------------ */
async function refreshMe() { const { user } = await backend.api('/api/auth/me'); backend.setUser(user); emit(); }

function renderTwofa(u) {
  const on = serverMode() && u;
  $('#twofaSection').hidden = !on;
  if (!on) return;
  $('#twofaStatus').textContent = u.totpEnabled ? 'On' : 'Off';
  $('#twofaSetupBtn').hidden = u.totpEnabled; $('#twofaOffBox').hidden = !u.totpEnabled;
  if (u.totpEnabled) $('#twofaBox').hidden = true;
}

function initTwofa() {
  $('#twofaSetupBtn').addEventListener('click', async () => {
    try {
      const r = await backend.api('/api/auth/2fa/setup', { method: 'POST' });
      $('#twofaSecret').textContent = r.secret.match(/.{1,4}/g).join(' ');
      $('#twofaLink').href = r.otpauth; $('#twofaBox').hidden = false; $('#twofaCode').focus();
    } catch (e) { showToast(e.message, 'error'); }
  });
  $('#twofaEnableBtn').addEventListener('click', async () => {
    try { await backend.api('/api/auth/2fa/enable', { method: 'POST', body: { code: $('#twofaCode').value.trim() } }); $('#twofaCode').value = ''; await refreshMe(); showToast('Two-step login is on.', 'success'); }
    catch (e) { showToast(e.message, 'error'); }
  });
  $('#twofaDisableBtn').addEventListener('click', async () => {
    try { await backend.api('/api/auth/2fa/disable', { method: 'POST', body: { password: $('#twofaPassword').value } }); $('#twofaPassword').value = ''; await refreshMe(); showToast('Two-step login is off.', 'info'); }
    catch (e) { showToast(e.message, 'error'); }
  });
}

/* ------------------------------ UI wiring ------------------------------ */
function switchAuthTab(which) {
  ['Login', 'Register'].forEach((n) => {
    const active = n === which;
    $(`#tab${n}`).classList.toggle('active', active); $(`#tab${n}`).setAttribute('aria-selected', String(active)); $(`#panel${n}`).hidden = !active;
  });
}
function setBusy(btn, busy) {
  btn.dataset.label ||= btn.innerHTML; btn.disabled = busy;
  btn.innerHTML = busy ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> …' : btn.dataset.label;
}

function renderSession(u) {
  $('#loginBtn').hidden = Boolean(u); $('#profileBtn').hidden = !u; $('#profileBtn').style.display = u ? '' : 'none';
  $('#profileBtnLabel').textContent = u ? u.name.split(' ')[0] : 'Profile';
  $('#sessionUser').innerHTML = `<i class="fas fa-user-circle" aria-hidden="true"></i> ${u ? h(u.name) : 'Guest'}`;
  $('#lastLogin').textContent = u ? formatDate(loginTime()) : '—';
  $('#adminPanelBtn').hidden = !isAdmin(u);
  renderTwofa(u);
}

function fillProfile() {
  const u = currentUser(); if (!u) return;
  $('#profileName').textContent = u.name; $('#profileEmail').textContent = u.email; $('#profileAvatar').textContent = u.name.trim()[0].toUpperCase();
  $('#profileAge').value = u.profile.age; $('#profileWeight').value = u.profile.weight;
  $('#profileConditions').value = u.profile.conditions; $('#profileAllergies').value = u.profile.allergies;
  $('#profileAbhaNumber').value = u.abha?.number || ''; $('#profileAbhaAddress').value = u.abha?.address || '';
  $('#profileLoginTime').textContent = formatDate(loginTime());
  $('#profileChatCount').textContent = store.get(KEYS.chat, []).length * 2;
  renderTwofa(u);
}

export async function initAuth() {
  $('#loginBtn').addEventListener('click', () => { switchAuthTab('Login'); openModal('loginModal'); });
  $('#profileBtn').addEventListener('click', () => { fillProfile(); openModal('profileModal'); });
  $('#tabLogin').addEventListener('click', () => switchAuthTab('Login'));
  $('#tabRegister').addEventListener('click', () => switchAuthTab('Register'));
  for (const [panel, btn] of [['#panelLogin', '#doLoginBtn'], ['#panelRegister', '#doRegisterBtn']]) {
    $(panel).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(btn).click(); } });
  }

  $('#doLoginBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget; setBusy(btn, true);
    try {
      const u = await login({ email: $('#loginEmail').value, password: $('#loginPassword').value, totp: $('#loginTOTP').value });
      $('#loginPassword').value = ''; $('#loginTOTP').value = ''; closeModal('loginModal'); showToast(`Welcome back, ${u.role === 'doctor' ? u.name : u.name.split(' ')[0]}.`, 'success');
    } catch (err) { showToast(err.message, 'error'); if (/6-digit/.test(err.message)) $('#loginTOTP').focus(); } finally { setBusy(btn, false); }
  });
  $('#doRegisterBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget; setBusy(btn, true);
    try {
      const u = await register({ name: $('#regName').value, email: $('#regEmail').value, password: $('#regPassword').value, consent: $('#consentCheck').checked });
      $('#regPassword').value = ''; closeModal('loginModal'); showToast(`Account created. Welcome, ${u.name.split(' ')[0]}.`, 'success');
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(btn, false); }
  });
  $('#oauthBtn').addEventListener('click', () => { location.href = '/api/auth/oauth/start'; });
  $('#saveProfileBtn').addEventListener('click', async () => {
    try {
      await updateProfile({ age: $('#profileAge').value, weight: $('#profileWeight').value, conditions: $('#profileConditions').value, allergies: $('#profileAllergies').value, abhaNumber: $('#profileAbhaNumber').value, abhaAddress: $('#profileAbhaAddress').value });
      showToast(serverMode() ? 'Profile saved.' : 'Profile saved on this device.', 'success'); fillProfile();
    } catch (err) { showToast(err.message, 'error'); }
  });
  $('#logoutBtn').addEventListener('click', async () => { await logout(); closeModal('profileModal'); showToast('You have been logged out.', 'info'); });
  initTwofa();

  backend.onChange(() => emit());                          // register BEFORE restoring, so the app hears about a resumed session
  // server mode: resume session, handle the OAuth return, show the social button only if the server has it configured
  if (serverMode()) {
    if (location.hash.includes('oauth=ok')) { store.set(KEYS.hasSession, true); history.replaceState(null, '', location.pathname); }
    await backend.restoreSession();
    try { $('#oauthBtn').hidden = !(await backend.api('/api/auth/oauth/status', { auth: false })).enabled; } catch { $('#oauthBtn').hidden = true; }
    const u = backend.getUser(); if (u?.lang) setLang(u.lang);
  } else { $('#oauthBtn').hidden = true; }
  onAuthChange(renderSession);
}
