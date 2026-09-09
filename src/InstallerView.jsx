// src/InstallerView.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { parseDXF } from './dxfParser.js'
import { latLngToTM35FIN } from './coords.js'
import { sb } from './supabaseClient.js'
import AuthGate from './AuthGate.jsx'
import { renderPinMapThumb, CAT_EN, SEV_EN, compressImage } from './shared.js'
import { subscribeToPush, sendPushNotification } from './push.js'
import MapView from './MapView.jsx'
import Diary from './Diary.jsx'

const FIXED_BATCH_KEY_PREFIX = 'korpnex_installer_fixed_batch_' // + auth user id
const sevBg = { Kriittinen: '#fde2e2', Huomio: '#fdf0d5', Info: '#dcefe3' }
const sevColor = { Kriittinen: '#b02828', Huomio: '#a06800', Info: '#1a7a45' }

// Asentajan kirjautuminen on jaettu AuthGate (src/AuthGate.jsx) — sama
// komponentti kuin Valvomossa/tarkastajalla. allowedRoles sallii roolit
// 'asentaja' JA 'admin' (yrityksen admin voi tarvittaessa myös toimia
// kentällä samalla tilillä).
export default function InstallerView() {
  return (
    <AuthGate allowedRoles={['asentaja', 'admin']} title="Asentaja">
      {({ session, profile, logout }) => <InstallerApp session={session} profile={profile} logout={logout} />}
    </AuthGate>
  )
}

function InstallerApp({ session, profile, logout }) {
  const [lang, setLang] = useState('fi')
  const [mainTab, setMainTab] = useState('vika') // 'vika' | 'paivakirja'
  // Ensikirjautumisella luodaan automaattisesti installers-rivi jonka id =
  // auth.uid() — vanha nimi+PIN-valintaruutu on poistunut kokonaan, PIN-
  // kirjautumista ei enää ole. undefined = tarkistetaan/luodaan.
  const [installer, setInstaller] = useState(undefined)
  const [provisionErr, setProvisionErr] = useState('')
  const [sites, setSites] = useState([])

  const [tasks, setTasks] = useState(null) // null = ladataan
  const [siteId, setSiteId] = useState(null)
  const [diarySiteId, setDiarySiteId] = useState('') // Päiväkirjan valittu työmaa — oma valinta, ei sidottu tehtävälistan siteId:hen
  const [mapData, setMapData] = useState(null)
  const [gpsCoords, setGpsCoords] = useState(null)
  const [pushMsg, setPushMsg] = useState('')
  const [fixedBatch, setFixedBatch] = useState([]) // korjatut mutta ei vielä kuitatut asentajan istunnossa
  const [confirmMsg, setConfirmMsg] = useState('')
  const [fixPhotos, setFixPhotos] = useState({}) // { [observation.id]: dataUrl } — pakollinen korjauskuva ennen "Merkitse korjatuksi"
  const [photoBusy, setPhotoBusy] = useState({}) // { [id]: true } kun kuvaa vielä pakataan
  const taskRefs = useRef({}) // { [observation.id]: HTMLElement } — yleiskartan napautus vierittää oikeaan korttiin
  const [highlightId, setHighlightId] = useState(null) // hetkellinen korostus kartalta navigoitaessa

  // Läheltäpiti-ilmoitus: asentaja voi ilmoittaa myös suoraan, ei vain
  // korjata työnjohtajan/tarkastajan luomia vikoja. Ei korjausseurantaa —
  // insertoidaan observations-tauluun type='laheltapiti', ei liitetä
  // mihinkään tehtävälistaan (ks. loadTasks, joka suodattaa nämä pois).
  const [nmOpen, setNmOpen] = useState(false)
  const [nmSiteId, setNmSiteId] = useState('')
  const [nmSev, setNmSev] = useState('Huomio')
  const [nmNote, setNmNote] = useState('')
  const [nmBusy, setNmBusy] = useState(false)
  const [nmMsg, setNmMsg] = useState('')
  const [nmPhoto, setNmPhoto] = useState(null) // dataUrl tai null — valinnainen
  const [nmPhotoBusy, setNmPhotoBusy] = useState(false)

  const t = key => {
    const dict = {
      title: { fi: 'Omat tehtävät', en: 'My tasks' },
      logout: { fi: 'Kirjaudu ulos', en: 'Log out' },
      noTasks: { fi: 'Ei avoimia tehtäviä 🎉', en: 'No open tasks 🎉' },
      markFixed: { fi: '✓ Merkitse korjatuksi', en: '✓ Mark as fixed' },
      loading: { fi: 'Ladataan…', en: 'Loading…' },
      notifOn: { fi: '🔔 Salli ilmoitukset', en: '🔔 Enable notifications' },
      notifOnDone: { fi: '🔔 Ilmoitukset päällä', en: '🔔 Notifications on' },
      row: { fi: 'rivi', en: 'row' },
      confirmBatch: { fi: 'Kuittaa työnjohtajalle', en: 'Confirm to supervisor' },
      fixedCount: { fi: 'korjattu, ei vielä lähetetty', en: 'fixed, not sent yet' },
      addFixPhoto: { fi: '📷 Ota korjauskuva', en: '📷 Take fix photo' },
      retakeFixPhoto: { fi: '📷 Ota uusi kuva', en: '📷 Retake photo' },
      needPhoto: { fi: 'Ota kuva korjauksesta ennen kuin voit merkitä sen korjatuksi', en: 'Take a photo of the fix before marking it done' },
      compressing: { fi: 'Käsitellään kuvaa…', en: 'Processing photo…' },
      overviewTitle: { fi: '📍 Kaikki avoimet viat kartalla', en: '📍 All open faults on map' },
      nmBtn: { fi: '⚠️ Ilmoita läheltäpiti', en: '⚠️ Report near-miss' },
      nmTitle: { fi: 'Läheltäpiti-ilmoitus', en: 'Near-miss report' },
      nmSiteLabel: { fi: 'Työmaa', en: 'Site' },
      nmSevLabel: { fi: 'Vakavuus', en: 'Severity' },
      nmNoteLabel: { fi: 'Kuvaa tilanne', en: 'Describe the situation' },
      nmNotePlaceholder: { fi: 'Mitä tapahtui, missä, ketä koski...', en: 'What happened, where, who was involved...' },
      nmSend: { fi: 'Lähetä ilmoitus', en: 'Send report' },
      nmCancel: { fi: 'Peruuta', en: 'Cancel' },
      nmSent: { fi: '✓ Ilmoitus lähetetty', en: '✓ Report sent' },
      nmNeedNote: { fi: 'Kuvaa tilanne ennen lähettämistä', en: 'Describe the situation before sending' },
      nmNeedSite: { fi: 'Valitse työmaa', en: 'Select a site' },
      nmError: { fi: 'Virhe', en: 'Error' },
      nmPhotoLabel: { fi: 'Kuva (valinnainen)', en: 'Photo (optional)' },
      nmAddPhoto: { fi: '📷 Ota kuva', en: '📷 Take photo' },
      nmRetakePhoto: { fi: '📷 Ota uusi kuva', en: '📷 Retake photo' },
      nmPhotoCompressing: { fi: 'Käsitellään kuvaa…', en: 'Processing photo…' },
    }
    return dict[key]?.[lang] ?? key
  }

  // Varmistaa että kirjautuneella auth-käyttäjällä on installers-rivi jonka
  // id = auth.uid(). Vanhoilla nimi+PIN-ajan riveillä ei ollut mitään
  // yhteyttä oikeisiin Auth-tileihin, niin uusi rivi luodaan aina
  // ensimmäisellä kirjautumisella (ja säilyy sen jälkeen ennallaan).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: existing, error } = await sb.from('installers').select('*').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      if (error) { setProvisionErr(error.message); return }
      if (existing) { setInstaller(existing); return }
      const name = profile.name || session.user.email
      const { data: created, error: insErr } = await sb.from('installers')
        .insert([{ id: session.user.id, name, company_id: profile.company_id }])
        .select().single()
      if (cancelled) return
      if (insErr) { setProvisionErr(insErr.message); return }
      setInstaller(created)
    })()
    return () => { cancelled = true }
  }, [session.user.id, profile.company_id, profile.name, session.user.email])

  // Palauta kesken jäänyt "korjattu mutta ei vielä kuitattu" -lista, jos
  // sovellus suljettiin (esim. puhelin lukittui taskussa) ennen kuin
  // asentaja ehti painaa koontikuittausta. Ilman tätä lista nollaantuisi
  // hiljaa ja työnjohtaja jäisi kokonaan ilman ilmoitusta niistä korjauksista
  // — itse korjausmerkinnät ovat toki jo tallessa Supabasessa, mutta
  // ilmoitus jäisi silti lähettämättä.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FIXED_BATCH_KEY_PREFIX + session.user.id)
      if (raw) setFixedBatch(JSON.parse(raw))
    } catch {}
  }, [session.user.id])

  // Tallenna lista joka kerta kun se muuttuu, jotta sovelluksen sulkeminen
  // (vahingossa tai tarkoituksella) ei koskaan hukkaa kertyneitä korjauksia.
  useEffect(() => {
    try {
      if (fixedBatch.length > 0) localStorage.setItem(FIXED_BATCH_KEY_PREFIX + session.user.id, JSON.stringify(fixedBatch))
      else localStorage.removeItem(FIXED_BATCH_KEY_PREFIX + session.user.id)
    } catch {}
  }, [fixedBatch, session.user.id])

  // Yrityksen työmaat DB:stä — käytetään observations.site (nimiteksti) →
  // sites.id -yhteyden selvittämiseen DXF-polkua varten (ks. alempi useEffect).
  useEffect(() => {
    sb.from('sites').select('*').then(({ data }) => setSites(data || []))
  }, [])

  // Fetch open tasks assigned to this installer. Läheltäpiti-ilmoitukset
  // (type = 'laheltapiti') eivät kuulu tähän listaan — niillä ei ole
  // korjausseurantaa (ei korjauskuvaa/"merkitse korjatuksi" -työnkulkua),
  // vanhat rivit (type = null) tulkitaan aina "vika":ksi.
  async function loadTasks() {
    if (!installer) return
    const { data } = await sb.from('observations')
      .select('*')
      .eq('assigned_installer_id', installer.id)
      .eq('status', 'avoin')
      .order('created_at', { ascending: true })
    setTasks((data || []).filter(o => (o.type || 'vika') !== 'laheltapiti'))
  }
  useEffect(() => { loadTasks() }, [installer])

  // Pre-render a small STATIC map snapshot per task (once, memoized) instead
  // of mounting a full interactive <MapView> for every open task. With many
  // open tasks this used to mount that many live SVG maps with touch/mouse
  // listeners at once, which was heavy enough to crash mobile Safari
  // ("Toistuva ongelma verkkosivulla"). Only recomputes when the task list
  // or the map data actually changes.
  const thumbById = useMemo(() => {
    const map = new Map()
    if (!mapData || !tasks) return map
    tasks.forEach(o => {
      if (o.pin_x == null) return
      try { map.set(o.id, renderPinMapThumb(mapData, { x: o.pin_x, y: o.pin_y })) } catch (e) { console.error('thumb render failed:', e) }
    })
    return map
  }, [mapData, tasks])

  // Kaikkien avointen tehtävien pinnit yhtä, elävää yleiskarttaa varten
  // listan yläreunassa — kevyt lisä thumbById:n rinnalle, ei korvaa sitä.
  // MapView'lle annetaan nämä extraPins-propsina (samat oranssit pisteet
  // joita työnjohtajan pikalisäyskin käyttää), ja pin=null koska mikään
  // yksittäinen tehtävä ei ole tässä "valittuna".
  const overviewTasks = useMemo(
    () => (tasks || []).filter(o => o.pin_x != null),
    [tasks]
  )
  const overviewPins = useMemo(
    () => overviewTasks.map(o => ({ x: o.pin_x, y: o.pin_y })),
    [overviewTasks]
  )

  // Yleiskartan napautus vierittää lähimpään tehtävään sen sijaan että
  // asettaisi uuden pinnin (tässä näkymässä ei koskaan luoda uusia
  // havaintoja — MapView'n onPin-kutsu vain uudelleenkäytetään navigointiin).
  function scrollToNearestTask(coords) {
    let best = Infinity, bestId = null
    overviewTasks.forEach(o => {
      const d = Math.hypot(o.pin_x - coords.x, o.pin_y - coords.y)
      if (d < best) { best = d; bestId = o.id }
    })
    if (bestId == null) return
    taskRefs.current[bestId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(bestId)
    setTimeout(() => setHighlightId(id => (id === bestId ? null : id)), 1800)
  }

  // Figure out which site's map to show — first distinct site among open tasks.
  // observations.site tallentaa työmaan NIMEN (label), joten se pitää
  // yhdistää sites-tauluun id:n löytämiseksi DXF-tallennuspolkua varten.
  useEffect(() => {
    if (!tasks || tasks.length === 0 || sites.length === 0) return
    const firstSite = tasks[0].site
    const found = sites.find(s => s.label === firstSite)
    if (found) setSiteId(found.id)
  }, [tasks, sites])

  useEffect(() => {
    if (!siteId) return
    setMapData(null)
    sb.storage.from('maps').download(`${profile.company_id}/${siteId}.dxf`).then(({ data, error }) => {
      if (error || !data) return
      data.text().then(text => {
        const parsed = parseDXF(text)
        if (parsed) setMapData(parsed)
      })
    })
  }, [siteId, profile.company_id])

  useEffect(() => {
    if (!navigator.geolocation || !mapData) return
    const watcher = navigator.geolocation.watchPosition(pos => {
      const { x, y } = latLngToTM35FIN(pos.coords.latitude, pos.coords.longitude)
      const mapX = (x - mapData.minX) / (mapData.maxX - mapData.minX)
      const mapY = 1 - (y - mapData.minY) / (mapData.maxY - mapData.minY)
      setGpsCoords({ x: Math.max(-0.2, Math.min(1.2, mapX)), y: Math.max(-0.2, Math.min(1.2, mapY)) })
    }, null, { enableHighAccuracy: true, maximumAge: 5000 })
    return () => navigator.geolocation.clearWatch(watcher)
  }, [mapData])

  async function enableNotifications() {
    const res = await subscribeToPush('installer', installer.id, profile.company_id)
    setPushMsg(res.ok ? t('notifOnDone') : (res.reason || 'Ei onnistunut'))
  }

  // Oletustyömaa läheltäpiti-lomakkeeseen: sama työmaa jota tehtävälistassa
  // juuri näytetään (siteId), tai ensimmäinen yrityksen työmaa jos avoimia
  // tehtäviä ei ole yhtään.
  useEffect(() => {
    if (nmSiteId) return
    if (siteId) { setNmSiteId(siteId); return }
    if (sites.length > 0) setNmSiteId(sites[0].id)
  }, [siteId, sites, nmSiteId])

  // Oletustyömaa Päiväkirjalle: sama logiikka kuin läheltäpiti-lomakkeella.
  useEffect(() => {
    if (diarySiteId) return
    if (siteId) { setDiarySiteId(siteId); return }
    if (sites.length > 0) setDiarySiteId(sites[0].id)
  }, [siteId, sites, diarySiteId])

  async function addNearMissPhoto(file) {
    if (!file) return
    setNmPhotoBusy(true)
    const src = await compressImage(file)
    setNmPhotoBusy(false)
    if (src) setNmPhoto(src)
  }

  async function submitNearMiss() {
    if (!nmNote.trim()) { setNmMsg(t('nmNeedNote')); return }
    if (!nmSiteId) { setNmMsg(t('nmNeedSite')); return }
    setNmBusy(true); setNmMsg('')
    const siteLabel = sites.find(s => s.id === nmSiteId)?.label || ''
    const { error } = await sb.from('observations').insert([{
      cat: 'Läheltäpiti', sev: nmSev, note: nmNote.trim(), muu: '',
      type: 'laheltapiti', pin_x: null, pin_y: null, photo: nmPhoto,
      site: siteLabel, inspector: installer?.name || session.user.email, rivi: null,
      status: 'avoin', assigned_installer_id: null, assigned_team_id: null, report_batch: null,
      company_id: profile.company_id, created_at: new Date().toISOString(),
    }])
    setNmBusy(false)
    if (error) { setNmMsg(t('nmError') + ': ' + error.message); return }
    setNmNote(''); setNmPhoto(null)
    setNmMsg(t('nmSent'))
    setTimeout(() => { setNmOpen(false); setNmMsg('') }, 1500)
  }

  async function addFixPhoto(id, file) {
    if (!file) return
    setPhotoBusy(prev => ({ ...prev, [id]: true }))
    const src = await compressImage(file)
    setPhotoBusy(prev => ({ ...prev, [id]: false }))
    if (src) setFixPhotos(prev => ({ ...prev, [id]: src }))
  }

  // Merkitsee havainnon korjatuksi HETI Supabaseen (data ei häviä vaikka
  // sovellus suljettaisiin), mutta EI lähetä ilmoitusta työnjohtajalle vielä
  // — jos asentaja korjaa esim. 40 vikaa peräkkäin, työnjohtaja ei halua 40
  // erillistä ilmoitusta. Sen sijaan korjaukset kertyvät `fixedBatch`-listaan,
  // ja asentaja lähettää yhden koontikuittauksen alapalkin napista kun on
  // valmis (ks. confirmBatch).
  //
  // Korjauskuva on pakollinen — nappi on piilotettu/pois käytöstä kunnes
  // fixPhotos[o.id] on olemassa (ks. käyttöliittymä alempana), joten tämä
  // funktio ei koskaan kutsu ilman kuvaa, mutta tarkistetaan silti
  // varmuuden vuoksi ettei vahingossa tallenneta ilman kuvaa.
  async function markFixed(o) {
    const photo = fixPhotos[o.id]
    if (!photo) return
    await sb.from('observations').update({
      status: 'korjattu', fixed_at: new Date().toISOString(), fixed_photo: photo,
    }).eq('id', o.id)
    setTasks(prev => prev.filter(x => x.id !== o.id))
    setFixedBatch(prev => [...prev, { cat: o.cat, site: o.site, reportBatch: o.report_batch }])
    setFixPhotos(prev => {
      const next = { ...prev }
      delete next[o.id]
      return next
    })
  }

  async function confirmBatch() {
    if (fixedBatch.length === 0) return
    const n = fixedBatch.length
    const cats = [...new Set(fixedBatch.map(f => f.cat))]
    const catSummary = cats.length <= 2 ? cats.join(', ') : `${cats.length} eri vikatyyppiä`
    const site = fixedBatch[0]?.site || ''
    setConfirmMsg(lang === 'en' ? 'Sending…' : 'Lähetetään…')
    const installerName = installer?.name || session.user.email
    const res = await sendPushNotification({
      role: 'supervisor',
      title: lang === 'en'
        ? `${installerName} fixed ${n} item${n === 1 ? '' : 's'}`
        : `${installerName} korjasi ${n} havainto${n === 1 ? 'n' : 'a'}`,
      body: `${catSummary} — ${site}`,
      tag: fixedBatch[0]?.reportBatch || undefined,
    })
    setFixedBatch([])
    setConfirmMsg(res?.sent > 0 ? '✓ ' + (lang === 'en' ? 'Sent' : 'Lähetetty') : '✓ ' + (lang === 'en' ? 'Saved' : 'Tallennettu'))
    setTimeout(() => setConfirmMsg(''), 4000)
  }

  // --- Ensikirjautuminen kesken: luodaan installers-rivi automaattisesti ---
  if (installer === undefined) {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto', minHeight: '100vh', background: '#f4f6fb', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, alignItems: 'center', textAlign: 'center' }}>
        <img src="/korpnex-icon.png" alt="Korpnex" style={{ height: 64, width: 'auto', display: 'block', borderRadius: 10 }} />
        {provisionErr ? (
          <>
            <div style={{ color: '#d63030', fontSize: 13.5 }}>Virhe tilin valmistelussa: {provisionErr}</div>
            <button onClick={logout} style={{ padding: '10px 18px', background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700 }}>Kirjaudu ulos</button>
          </>
        ) : (
          <div style={{ color: '#6670a0', fontSize: 14 }}>{t('loading')}</div>
        )}
      </div>
    )
  }

  // --- Task list ---
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#f4f6fb' }}>
      <div style={{ background: '#070b17', padding: '16px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/korpnex-icon.png" alt="Korpnex" style={{ height: 32, width: 'auto', display: 'block' }} />
            <span style={{ fontSize: 19, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>KORPNEX</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500, marginLeft: 2 }}>· {t('title')}</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginLeft: 40 }}>{installer.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setLang(lang === 'fi' ? 'en' : 'fi')} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'rgba(255,255,255,0.85)', borderRadius: 6, padding: '5px 9px', fontSize: 12, fontWeight: 700 }}>
            {lang === 'fi' ? 'EN' : 'FI'}
          </button>
          <button onClick={logout} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'rgba(255,255,255,0.85)', borderRadius: 6, padding: '5px 9px', fontSize: 12 }}>
            {t('logout')}
          </button>
        </div>
      </div>

      {/* Tab switcher: Tehtävät / Päiväkirja */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', background: '#eef0f2' }}>
        {[['vika', t('title')], ['paivakirja', '📔 Päiväkirja']].map(([val, lbl]) => {
          const active = mainTab === val
          return (
            <button key={val} onClick={() => setMainTab(val)} style={{
              flex: 1, padding: '9px 4px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              border: 'none', background: active ? '#1560c4' : 'transparent',
              color: active ? '#fff' : '#5b6270'
            }}>{lbl}</button>
          )
        })}
      </div>

      {mainTab === 'paivakirja' ? (
        <>
          {/* Työmaa-valitsin Päiväkirjalle — piilossa kun yrityksellä on
              vain yksi työmaa, näkyy pudotusvalikkona kun niitä on useampi. */}
          <div style={{ padding: '10px 12px', background: '#fff', borderBottom: '1px solid #d0d5e8' }}>
            {sites.length > 1 ? (
              <select value={diarySiteId} onChange={e => setDiarySiteId(e.target.value)} style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #d0d5e8', fontSize: 13.5, background: '#fff' }}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 13, color: '#0d1a6e', fontWeight: 700 }}>
                🏗 {sites[0]?.label || 'Ei työmaita — luo yksi Valvomon Työmaat-välilehdellä'}
              </div>
            )}
          </div>
          <Diary session={session} profile={profile} siteId={diarySiteId} siteLabel={sites.find(s => s.id === diarySiteId)?.label || ''} />
        </>
      ) : (
      <>
      <div style={{ padding: 12 }}>
        <button onClick={enableNotifications} style={{ width: '100%', padding: 10, background: '#fff', border: '1px solid #d0d5e8', borderRadius: 8, fontSize: 13, color: '#1560c4', fontWeight: 600, marginBottom: 8 }}>
          {pushMsg || t('notifOn')}
        </button>

        <button onClick={() => setNmOpen(v => !v)} style={{ width: '100%', padding: 10, background: nmOpen ? '#fdf0d5' : '#fff', border: '1px solid #e0b040', borderRadius: 8, fontSize: 13, color: '#a06800', fontWeight: 700, marginBottom: 12 }}>
          {t('nmBtn')}
        </button>

        {nmOpen && (
          <div style={{ background: '#fff', border: '1px solid #e0b040', borderRadius: 10, padding: 12, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a06800' }}>{t('nmTitle')}</div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6670a0', marginBottom: 4 }}>{t('nmSiteLabel')}</div>
              <select value={nmSiteId} onChange={e => setNmSiteId(e.target.value)} style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #d0d5e8', fontSize: 13.5, background: '#fff' }}>
                {sites.length === 0 && <option value="">—</option>}
                {sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6670a0', marginBottom: 4 }}>{t('nmSevLabel')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Kriittinen', 'Huomio', 'Info'].map(s => (
                  <button key={s} onClick={() => setNmSev(s)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: `1px solid ${nmSev === s ? sevColor[s] : '#d0d5e8'}`,
                    background: nmSev === s ? sevBg[s] : '#eef0f7',
                    color: nmSev === s ? sevColor[s] : '#6670a0'
                  }}>{s}</button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6670a0', marginBottom: 4 }}>{t('nmNoteLabel')}</div>
              <textarea
                value={nmNote}
                onChange={e => setNmNote(e.target.value)}
                placeholder={t('nmNotePlaceholder')}
                style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #d0d5e8', fontSize: 13.5, resize: 'none', minHeight: 64, lineHeight: 1.5, boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6670a0', marginBottom: 4 }}>{t('nmPhotoLabel')}</div>
              {nmPhoto && (
                <div style={{ position: 'relative', width: 90, marginBottom: 6 }}>
                  <img src={nmPhoto} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid #d0d5e8', display: 'block' }} />
                  <button onClick={() => setNmPhoto(null)} style={{ position: 'absolute', top: -6, right: -6, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: 22, height: 22, color: '#fff', fontSize: 14 }}>×</button>
                </div>
              )}
              <label style={{ display: 'inline-block', padding: '8px 14px', background: '#eef0f7', border: '1px solid #d0d5e8', borderRadius: 8, fontSize: 12.5, color: '#1560c4', fontWeight: 600, cursor: 'pointer' }}>
                {nmPhotoBusy ? t('nmPhotoCompressing') : (nmPhoto ? t('nmRetakePhoto') : t('nmAddPhoto'))}
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => addNearMissPhoto(e.target.files?.[0])} />
              </label>
            </div>

            {nmMsg && <div style={{ fontSize: 12.5, color: nmMsg === t('nmSent') ? '#1a7a45' : '#b02828', fontWeight: 600 }}>{nmMsg}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setNmOpen(false); setNmMsg('') }} style={{ flex: 1, padding: 10, background: '#eef0f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#6670a0' }}>
                {t('nmCancel')}
              </button>
              <button onClick={submitNearMiss} disabled={nmBusy} style={{ flex: 2, padding: 10, background: '#a06800', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', opacity: nmBusy ? 0.6 : 1 }}>
                {nmBusy ? t('loading') : t('nmSend')}
              </button>
            </div>
          </div>
        )}

        {mapData && overviewPins.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6670a0', marginBottom: 6 }}>
              {t('overviewTitle')}
            </div>
            <MapView
              mapData={mapData}
              pin={null}
              onPin={scrollToNearestTask}
              gpsCoords={gpsCoords}
              extraPins={overviewPins}
              readOnly
              height={200}
            />
          </div>
        )}

        {tasks === null && <div style={{ textAlign: 'center', color: '#6670a0', padding: 40 }}>{t('loading')}</div>}
        {tasks && tasks.length === 0 && <div style={{ textAlign: 'center', color: '#6670a0', padding: 40 }}>{t('noTasks')}</div>}

        {tasks && tasks.map(o => {
          const catLabel = lang === 'en' ? (CAT_EN[o.cat] || o.cat) : o.cat
          const sevLabel = lang === 'en' ? (SEV_EN[o.sev] || o.sev) : o.sev
          return (
            <div
              key={o.id}
              ref={el => { taskRefs.current[o.id] = el }}
              style={{
                background: '#fff', borderRadius: 12, marginBottom: 12, overflow: 'hidden',
                border: highlightId === o.id ? '2px solid #1560c4' : '1px solid #d0d5e8',
                boxShadow: highlightId === o.id ? '0 0 0 4px rgba(21,96,196,0.15)' : 'none',
                transition: 'box-shadow 0.3s, border-color 0.3s',
              }}
            >
              <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eef0f7' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e' }}>{catLabel}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: sevBg[o.sev], color: sevColor[o.sev] }}>{sevLabel}</span>
              </div>
              {o.note && <div style={{ padding: '8px 14px 0', fontSize: 13, color: '#333' }}>{o.note}</div>}
              {o.site && <div style={{ padding: '4px 14px 0', fontSize: 11, color: '#9aa2c0' }}>{o.site}</div>}

              {mapData && o.pin_x != null && (
                <div style={{ padding: 12 }}>
                  {thumbById.has(o.id) ? (
                    <img
                      src={thumbById.get(o.id)}
                      alt=""
                      style={{ width: '100%', display: 'block', borderRadius: 8, border: '1px solid #d0d5e8' }}
                    />
                  ) : (
                    <div style={{ height: 160, background: '#eef4ec', borderRadius: 8 }} />
                  )}
                </div>
              )}

              <div style={{ padding: 12, paddingTop: 0 }}>
                {fixPhotos[o.id] ? (
                  <div style={{ marginBottom: 8 }}>
                    <img
                      src={fixPhotos[o.id]}
                      alt=""
                      style={{ width: '100%', display: 'block', borderRadius: 8, border: '2px solid #1a8a50' }}
                    />
                    <label style={{ display: 'block', textAlign: 'center', marginTop: 6, fontSize: 12, color: '#1560c4', fontWeight: 600 }}>
                      {t('retakeFixPhoto')}
                      <input
                        type="file" accept="image/*" capture="environment"
                        onChange={e => addFixPhoto(o.id, e.target.files[0])}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </div>
                ) : (
                  <label style={{
                    display: 'block', textAlign: 'center', padding: 12, marginBottom: 8,
                    border: '1.5px dashed #d0d5e8', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    color: photoBusy[o.id] ? '#9aa2c0' : '#1560c4', cursor: 'pointer',
                  }}>
                    {photoBusy[o.id] ? t('compressing') : t('addFixPhoto')}
                    <input
                      type="file" accept="image/*" capture="environment"
                      onChange={e => addFixPhoto(o.id, e.target.files[0])}
                      style={{ display: 'none' }}
                      disabled={!!photoBusy[o.id]}
                    />
                  </label>
                )}
                <button
                  onClick={() => markFixed(o)}
                  disabled={!fixPhotos[o.id]}
                  title={!fixPhotos[o.id] ? t('needPhoto') : undefined}
                  style={{
                    width: '100%', padding: 12, color: '#fff', border: 'none', borderRadius: 8,
                    fontWeight: 700, fontSize: 14,
                    background: fixPhotos[o.id] ? '#1a8a50' : '#b7c0d8',
                    cursor: fixPhotos[o.id] ? 'pointer' : 'not-allowed',
                  }}
                >
                  {t('markFixed')}
                </button>
                {!fixPhotos[o.id] && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#9aa2c0', textAlign: 'center' }}>
                    {t('needPhoto')}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Koontipalkki: korjaukset kertyvät tähän ilman että jokaisesta lähtee
          oma ilmoitus — asentaja kuittaa kaikki kerralla yhdellä napilla, ja
          työnjohtaja saa yhden koonti-ilmoituksen monen sijaan. */}
      {fixedBatch.length > 0 && (
        <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '10px 12px calc(10px + env(safe-area-inset-bottom, 0px))', background: 'rgba(244,246,251,0.97)', borderTop: '1px solid #d0d5e8', backdropFilter: 'blur(4px)' }}>
          <button onClick={confirmBatch} style={{ width: '100%', padding: 13, background: '#1560c4', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            📬 {fixedBatch.length} {t('fixedCount')} — {t('confirmBatch')}
          </button>
          {confirmMsg && <div style={{ textAlign: 'center', fontSize: 12, color: '#1a8a50', fontWeight: 600, marginTop: 6 }}>{confirmMsg}</div>}
        </div>
      )}
      </>
      )}
    </div>
  )
}
