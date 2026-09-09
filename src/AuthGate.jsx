// src/AuthGate.jsx
//
// Jaettu kirjautumisportti KAIKILLE näkymille (Valvomo, asentaja,
// tarkastaja). Korvaa vanhan Dashboard.jsx:n sisäisen AuthGaten sekä
// InstallerView:n nimi+PIN-kirjautumisen — jatkossa KAIKKI kirjautuminen
// on oikea Supabase Auth -tili (sähköposti + salasana).
//
// Tekee neljä asiaa:
//   1) Kirjautuminen / Rekisteröityminen (uusi yritys) / Salasanan palautus.
//   2) Kirjautumisen jälkeen hakee profiles-rivin (company_id, role, name)
//      — tämä on käyttäjän "yritystila". Jos profiilia ei löydy (rekisteröi-
//      tyminen kesken, esim. sähköpostivahvistus oli päällä), näytetään
//      "Viimeistele rekisteröityminen" -näkymä joka pyytää yrityksen nimen
//      ja kutsuu complete-signup-Edge Functionia.
//   3) Antaa lapsikomponentille {session, profile} render-propina:
//        <AuthGate>{({ session, profile }) => ...}</AuthGate>
//   4) allowedRoles-propilla voi rajata näkymän vain tietyille rooleille
//      (esim. <AuthGate allowedRoles={['asentaja','admin']}>).
//
// "Kirjaudu ulos" on TARKOITUKSELLA jokaisen näkymän omassa headerissa
// (ei tässä), koska ulkoasu vaihtelee näkymittäin — mutta tarjoamme
// logout()-funktion myös "väärä rooli" -näkymässä, jotta väärällä tilillä
// kirjautunut pääsee helposti ulos vaihtaakseen tiliä.

import React, { useState, useEffect, useCallback } from 'react'
import { sb } from './supabaseClient.js'

const PENDING_COMPANY_KEY = 'korpnex_pending_company_name'

// supabase-js:n functions.invoke() palauttaa non-2xx-vastauksille aina
// yleisen "Edge Function returned a non-2xx status code" -viestin
// error.message:ssä, vaikka funktio itse palauttaisi kuvaavan
// { error: "..." } -JSON-bodyn — oikea syy pitää kaivaa error.context
// (raaka Response-olio) -kentästä erikseen. Tämä funktio yrittää sitä,
// ja palaa yleiseen viestiin jos body ei olekaan JSON.
export async function describeFnError(error, data) {
  if (data && data.error) return data.error
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.clone().json()
      if (body?.error) return body.error
    } catch { /* body ei ollut JSON — käytetään yleistä viestiä */ }
  }
  return error?.message || 'Tuntematon virhe'
}

const ROLE_LABEL = { admin: 'Ylläpitäjä', asentaja: 'Asentaja' }

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7fb', fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 4px 24px rgba(20,30,80,0.10)', padding: 32, width: 340, maxWidth: '100%' }}>
        {children}
      </div>
    </div>
  )
}

function Logo({ sub }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 18 }}>
      <img src="/korpnex-icon.png" alt="Korpnex" style={{ height: 52, width: 'auto', display: 'block', margin: '0 auto 10px', borderRadius: 10 }} />
      <div style={{ fontSize: 19, fontWeight: 800, color: '#1560c4', letterSpacing: 0.5 }}>
        KORPNEX <span style={{ opacity: 0.5, fontWeight: 500 }}>·</span> {sub}
      </div>
    </div>
  )
}

const inputStyle = { padding: 11, borderRadius: 8, border: '1px solid #d0d5e8', fontSize: 14 }
function primaryBtnStyle(busy) {
  return { padding: 12, background: busy ? '#9aa2c0' : '#1560c4', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer', marginTop: 4 }
}
const linkBtnStyle = { background: 'none', border: 'none', color: '#6670a0', fontSize: 12.5, cursor: 'pointer', marginTop: 2 }

export default function AuthGate({ children, allowedRoles, title }) {
  const [session, setSession] = useState(undefined) // undefined = tarkistetaan, null = ei kirjautunut
  const [profile, setProfile] = useState(undefined) // undefined = ei haettu, null = ei löytynyt (rekisteröinti kesken)

  // 'login' | 'signup' | 'forgot' | 'recovery'
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')

  const refreshProfile = useCallback(async (userId) => {
    const { data } = await sb.from('profiles').select('company_id, role, name, email').eq('id', userId).maybeSingle()
    setProfile(data || null)
    return data || null
  }, [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const s = data.session || null
      setSession(s)
      if (s) refreshProfile(s.user.id)
      else setProfile(null)
    })
    // PASSWORD_RECOVERY: käyttäjä tuli tähän sivuun sähköpostin palautuslinkistä.
    // Supabase-js on jo lukenut linkin mukana tulleen tokenin URL:sta ja
    // asettanut väliaikaisen istunnon automaattisesti.
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovery')
      setSession(s)
      if (s) refreshProfile(s.user.id)
      else setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [refreshProfile])

  // Kun profiilia ei löydy (rekisteröityminen kesken), esitäytä yrityksen
  // nimi localStorageen tallennetusta arvosta (signup()-vaiheesta), jos on.
  useEffect(() => {
    if (session && profile === null && !companyName) {
      try {
        const pending = localStorage.getItem(PENDING_COMPANY_KEY)
        if (pending) setCompanyName(pending)
      } catch { /* ei väliä */ }
    }
  }, [session, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  async function login() {
    setErr(''); setBusy(true)
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Väärä sähköposti tai salasana' : error.message)
  }

  async function signup() {
    setErr('')
    if (!companyName.trim()) { setErr('Yrityksen nimi vaaditaan'); return }
    if (!email.trim()) { setErr('Sähköposti vaaditaan'); return }
    if (password.length < 6) { setErr('Salasanan pitää olla vähintään 6 merkkiä'); return }
    if (password !== password2) { setErr('Salasanat eivät täsmää'); return }
    setBusy(true)
    const cleanEmail = email.trim()
    const cleanCompany = companyName.trim()
    const { data, error } = await sb.auth.signUp({
      email: cleanEmail,
      password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname + window.location.search },
    })
    if (error) {
      setBusy(false)
      setErr(error.message === 'User already registered' ? 'Tällä sähköpostilla on jo tili — kirjaudu sisään.' : error.message)
      return
    }
    try { localStorage.setItem(PENDING_COMPANY_KEY, cleanCompany) } catch { /* ei väliä */ }
    if (data.session) {
      // Sähköpostivahvistus ei ole päällä — istunto syntyi heti, viimeistellään suoraan.
      await finishSignup(cleanCompany)
      setBusy(false)
    } else {
      setBusy(false)
      setMsg('✓ Tili luotu. Tarkista sähköpostisi ja vahvista tili, sitten kirjaudu sisään — yrityksesi luodaan automaattisesti ensimmäisellä kirjautumisella.')
      setMode('login')
    }
  }

  // Kutsuu complete-signup-Edge Functionia joka luo companies+profiles-rivin
  // kirjautuneelle (mutta vielä "yrityksettömälle") käyttäjälle.
  async function finishSignup(nameOverride) {
    if (!session) return
    setErr(''); setBusy(true)
    const { data, error } = await sb.functions.invoke('complete-signup', {
      body: { company_name: nameOverride ?? companyName.trim() },
    })
    setBusy(false)
    if (error || data?.error) { setErr(await describeFnError(error, data)); return }
    try { localStorage.removeItem(PENDING_COMPANY_KEY) } catch { /* ei väliä */ }
    await refreshProfile(session.user.id)
  }

  async function sendReset() {
    setErr(''); setMsg(''); setBusy(true)
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname + window.location.search,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else setMsg('✓ Palautuslinkki lähetetty sähköpostiin, jos tili on olemassa.')
  }

  async function saveNewPassword() {
    setErr('')
    if (newPw.length < 6) { setErr('Salasanan pitää olla vähintään 6 merkkiä'); return }
    if (newPw !== newPw2) { setErr('Salasanat eivät täsmää'); return }
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password: newPw })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('✓ Salasana vaihdettu')
    setMode('login')
  }

  function logout() {
    sb.auth.signOut()
  }

  const heading = title || 'Kirjaudu'

  if (session === undefined || (session && profile === undefined)) {
    return <Shell><div style={{ textAlign: 'center', color: '#6670a0' }}>Ladataan…</div></Shell>
  }

  // --- Rekisteröityminen kesken: pyydetään yrityksen nimi ---
  if (session && profile === null) {
    return (
      <Shell>
        <Logo sub="Uusi yritys" />
        <div style={{ fontSize: 12.5, color: '#6670a0', marginBottom: 12, textAlign: 'center' }}>
          Tervetuloa, {session.user.email}! Viimeistele tilisi antamalla yrityksesi nimi.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="text" placeholder="Yrityksen nimi" value={companyName} onChange={e => setCompanyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && finishSignup()}
            style={inputStyle}
          />
          {err && <div style={{ color: '#d63030', fontSize: 12.5, textAlign: 'center' }}>{err}</div>}
          <button onClick={() => finishSignup()} disabled={busy || !companyName.trim()} style={primaryBtnStyle(busy)}>
            {busy ? 'Tallennetaan…' : 'Aloita käyttö'}
          </button>
          <button onClick={logout} style={linkBtnStyle}>Kirjaudu ulos</button>
        </div>
      </Shell>
    )
  }

  // --- Salasanan palautuslinkistä palattiin tähän ---
  if (mode === 'recovery') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#1560c4' }}>Aseta uusi salasana</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="password" placeholder="Uusi salasana" value={newPw} onChange={e => setNewPw(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password" placeholder="Uusi salasana (uudelleen)" value={newPw2} onChange={e => setNewPw2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveNewPassword()}
            style={inputStyle}
          />
          {err && <div style={{ color: '#d63030', fontSize: 12.5, textAlign: 'center' }}>{err}</div>}
          <button onClick={saveNewPassword} disabled={busy || !newPw || !newPw2} style={primaryBtnStyle(busy)}>
            {busy ? 'Tallennetaan…' : 'Tallenna uusi salasana'}
          </button>
        </div>
      </Shell>
    )
  }

  // --- Ei kirjautunut: kirjautuminen / rekisteröityminen / palautuspyyntö ---
  if (!session) {
    return (
      <Shell>
        <Logo sub={heading} />

        {mode === 'login' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {msg && <div style={{ color: '#1a8a50', fontSize: 12.5, textAlign: 'center', fontWeight: 700 }}>{msg}</div>}
            <input
              type="email" placeholder="Sähköposti" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              style={inputStyle}
            />
            <input
              type="password" placeholder="Salasana" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              style={inputStyle}
            />
            {err && <div style={{ color: '#d63030', fontSize: 12.5, textAlign: 'center' }}>{err}</div>}
            <button onClick={login} disabled={busy || !email || !password} style={primaryBtnStyle(busy)}>
              {busy ? 'Kirjaudutaan…' : 'Kirjaudu'}
            </button>
            <button onClick={() => { setMode('forgot'); setErr(''); setMsg('') }} style={linkBtnStyle}>
              Unohtuiko salasana?
            </button>
            <button onClick={() => { setMode('signup'); setErr(''); setMsg('') }} style={{ ...linkBtnStyle, fontWeight: 700, color: '#1560c4' }}>
              Ei tiliä? Rekisteröidy tässä →
            </button>
          </div>
        )}

        {mode === 'signup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: '#6670a0', marginBottom: 2 }}>
              Luo uusi yritystili — saat pääkäyttäjän (admin) oikeudet ja voit kutsua muut käyttäjät myöhemmin Valvomon Käyttäjät-välilehdeltä.
            </div>
            <input
              type="text" placeholder="Yrityksen nimi" value={companyName} onChange={e => setCompanyName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="email" placeholder="Sähköposti" value={email} onChange={e => setEmail(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password" placeholder="Salasana (vähintään 6 merkkiä)" value={password} onChange={e => setPassword(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password" placeholder="Salasana uudelleen" value={password2} onChange={e => setPassword2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && signup()}
              style={inputStyle}
            />
            {err && <div style={{ color: '#d63030', fontSize: 12.5, textAlign: 'center' }}>{err}</div>}
            <button onClick={signup} disabled={busy} style={primaryBtnStyle(busy)}>
              {busy ? 'Luodaan…' : 'Luo yritystili'}
            </button>
            <button onClick={() => { setMode('login'); setErr(''); setMsg('') }} style={linkBtnStyle}>
              ← Takaisin kirjautumiseen
            </button>
          </div>
        )}

        {mode === 'forgot' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: '#6670a0', marginBottom: 2 }}>
              Anna sähköpostiosoitteesi — lähetämme siihen linkin, jolla voit asettaa uuden salasanan.
            </div>
            <input
              type="email" placeholder="Sähköposti" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendReset()}
              style={inputStyle}
            />
            {err && <div style={{ color: '#d63030', fontSize: 12.5, textAlign: 'center' }}>{err}</div>}
            {msg && <div style={{ color: '#1a8a50', fontSize: 12.5, textAlign: 'center' }}>{msg}</div>}
            <button onClick={sendReset} disabled={busy || !email} style={primaryBtnStyle(busy)}>
              {busy ? 'Lähetetään…' : 'Lähetä palautuslinkki'}
            </button>
            <button onClick={() => { setMode('login'); setErr('') }} style={linkBtnStyle}>
              ← Takaisin kirjautumiseen
            </button>
          </div>
        )}
      </Shell>
    )
  }

  // --- Kirjautunut, profiili löytyi, mutta rooli ei sallittu tälle näkymälle ---
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(profile.role)) {
    return (
      <Shell>
        <Logo sub={heading} />
        <div style={{ textAlign: 'center', color: '#6670a0', fontSize: 13.5, marginBottom: 14 }}>
          Tilisi ({session.user.email}) rooli on <b>{ROLE_LABEL[profile.role] || profile.role}</b>, eikä sillä pääse tähän näkymään.
        </div>
        <button onClick={logout} style={{ ...primaryBtnStyle(false), background: '#6670a0' }}>Kirjaudu ulos</button>
      </Shell>
    )
  }

  return children({ session, profile, logout })
}
