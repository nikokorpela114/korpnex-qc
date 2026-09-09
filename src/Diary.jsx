// src/Diary.jsx — Päiväkirja: valitun työmaan etenemisen dokumentointi
// (työvaiheittain ryhmitellyt kuva+teksti-merkinnät -> PDF-raportti).
//
// HUOM: "projekti" ja "työmaa" ovat tarkoituksella SAMA asia — päiväkirjalla
// ei ole omaa, työmaista erillistä projektilistaa/-luontia. Käyttäjä valitsee
// työmaan yhteisestä valitsimesta (App.jsx/InstallerView.jsx, näkyy tab-
// switcherin yhteydessä — piilossa kun yrityksellä on vain yksi työmaa), ja
// Diary näyttää/tallentaa suoraan SEN työmaan merkinnät. Tämä komponentti saa
// työmaan id:n ja nimen propseina (siteId, siteLabel) — ei enää valitse
// mitään itse.
//
// Sovitettu alun perin erillisestä Rakennuspäiväkirja-sovelluksesta
// (ProjectDetail.jsx) tämän moniyritys-QC-sovelluksen sisälle. Alkuperäisessä
// versiossa oli myös ProjectList-näkymä (admin luo/nimeää/arkistoi
// "projekteja" käsin) — se on poistettu kokonaan, koska työmaat hallitaan
// jo Valvomon Työmaat-välilehdellä, eikä samaa asiaa haluttu kahteen kertaan.
//
// Oikeudet: kaikki yrityksen jäsenet (myös asentaja) näkevät työmaan
// merkinnät ja voivat lisätä uusia (myös asentaja dokumentoi omaa työtään).
// Yksittäisen merkinnän muokkaus/poisto onnistuu sen tekijältä itseltään tai
// adminilta. PDF-vienti on rajattu adminille (Valvomo-tili).
//
// Tyylitys inline style -objekteina (ei erillistä CSS-template-stringiä),
// samaa käytäntöä kuin App.jsx/InstallerView.jsx/Dashboard.jsx, ja
// värimaailma yhtenäistetty muun sovelluksen navy+sininen-brändiin
// (#070b17 / #1560c4).
//
// Kuvat: bucket "diary-photos" (yksityinen), polku
// "{company_id}/{site_id}/{entry_id}.jpg" — ks. paivakirja_schema.sql.
import React, { useState, useEffect, useCallback } from 'react'
import { sb } from './supabaseClient.js'
import { PHASES, OTHER_PHASE, findPhase, groupEntriesByPhase } from './phases.js'
import { buildDiaryPDF } from './diaryPdfBuilder.js'

const ALL_PHASES = [...PHASES, OTHER_PHASE]

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
}

// Pakkaa/pienentää kuvan ja palauttaa SEKÄ pakatun Blobin (ladataan
// Storageen) ETTÄ pikkukokoisen data URL -esikatselun (näytetään heti
// ruudulla ilman verkkopyyntöä). Eri paluuarvo kuin shared.js:n
// compressImage (joka palauttaa vain data URL:n) — tarvitaan tässä Blobia
// varten Storage-lähetystä, joten oma pieni apufunktio tähän tiedostoon.
function compressForUpload(file, maxDim = 1600, quality = 0.75) {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale); height = Math.round(height * scale)
        }
        const c = document.createElement('canvas')
        c.width = width; c.height = height
        c.getContext('2d').drawImage(img, 0, 0, width, height)
        const dataUrl = c.toDataURL('image/jpeg', quality)
        c.toBlob(blob => resolve(blob ? { blob, dataUrl } : null), 'image/jpeg', quality)
      }
      img.onerror = () => resolve(null)
      img.src = e.target.result
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export default function Diary({ session, profile, siteId, siteLabel }) {
  const companyId = profile.company_id
  const canManage = profile.role === 'admin'
  const myName = profile.name || session.user.email
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    sb.from('companies').select('name').eq('id', companyId).maybeSingle().then(({ data }) => {
      if (data?.name) setCompanyName(data.name)
    })
  }, [companyId])

  if (!siteId) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, background: '#f4f6fb' }}>
        <div style={{ textAlign: 'center', color: '#6670a0', fontSize: 13.5, lineHeight: 1.6 }}>
          Ei työmaita — luo yksi Valvomon Työmaat-välilehdellä, jotta Päiväkirja voidaan avata sille.
        </div>
      </div>
    )
  }

  return (
    <DiarySiteEntries
      siteId={siteId}
      siteLabel={siteLabel}
      session={session}
      canManage={canManage}
      myName={myName}
      companyId={companyId}
      companyName={companyName}
    />
  )
}

// ---------------------------------------------------------------------
// Valitun työmaan päiväkirjamerkinnät
// ---------------------------------------------------------------------
function DiarySiteEntries({ siteId, siteLabel, session, canManage, myName, companyId, companyName }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')

  const [composerOpen, setComposerOpen] = useState(false)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [phaseKey, setPhaseKey] = useState('')
  const [subphase, setSubphase] = useState('')
  const [subphaseCustom, setSubphaseCustom] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editPhaseKey, setEditPhaseKey] = useState('')
  const [editSubphase, setEditSubphase] = useState('')
  const [editSubphaseCustom, setEditSubphaseCustom] = useState(false)
  const [editNote, setEditNote] = useState('')

  const [pdfMode, setPdfMode] = useState(false)
  const [pdfBuilding, setPdfBuilding] = useState(false)
  const [pdfProgress, setPdfProgress] = useState({ done: 0, total: 0 })
  const [pdfBlob, setPdfBlob] = useState(null)
  const [pdfName, setPdfName] = useState('')
  const [pdfDownloaded, setPdfDownloaded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErrMsg('')
    const { data, error } = await sb.from('diary_entries').select('*')
      .eq('site_id', siteId).eq('archived', false)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('diary_entries load failed:', error)
      setErrMsg('⚠ Merkintöjen haku epäonnistui — tarkista yhteys ja päivitä.')
      setLoading(false)
      return
    }
    const rows = data || []
    const withUrls = await Promise.all(rows.map(async e => {
      if (!e.photo_path) return e
      const { data: signed } = await sb.storage.from('diary-photos').createSignedUrl(e.photo_path, 3600)
      return { ...e, _url: signed?.signedUrl || null }
    }))
    setEntries(withUrls)
    setLoading(false)
  }, [siteId])

  useEffect(() => { load() }, [load])

  function canEdit(e) { return canManage || e.created_by === session.user.id }

  function openComposer() {
    setComposerOpen(true)
    setPhotoBlob(null); setPhotoPreview(null)
    setPhaseKey(''); setSubphase(''); setSubphaseCustom(false); setNote('')
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const result = await compressForUpload(file)
    if (result) { setPhotoBlob(result.blob); setPhotoPreview(result.dataUrl) }
    e.target.value = ''
  }

  async function saveEntry() {
    if (!phaseKey) { alert('Valitse ensin työvaihe.'); return }
    setSaving(true)
    try {
      let photoPath = null
      if (photoBlob) {
        photoPath = `${companyId}/${siteId}/${uuid()}.jpg`
        const { error: upErr } = await sb.storage.from('diary-photos').upload(photoPath, photoBlob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
      }
      const phase = findPhase(phaseKey)
      const { data, error } = await sb.from('diary_entries').insert([{
        site_id: siteId,
        company_id: companyId,
        phase_key: phaseKey,
        phase_label: phase.label,
        subphase: subphase || null,
        note: note || null,
        photo_path: photoPath,
        created_by: session.user.id,
        created_by_name: myName,
      }]).select()
      if (error) throw error
      if (data?.[0]) {
        setEntries(prev => [{ ...data[0], _url: photoPreview }, ...prev])
      }
      setComposerOpen(false)
    } catch (err) {
      console.error('saveEntry failed:', err)
      alert('Tallennus epäonnistui — tarkista yhteys ja yritä uudelleen.')
    }
    setSaving(false)
  }

  function startEdit(e) {
    setEditingId(e.id)
    setEditPhaseKey(e.phase_key || '')
    const phase = findPhase(e.phase_key)
    const isKnown = e.subphase && phase.subphases.includes(e.subphase)
    setEditSubphase(e.subphase || '')
    setEditSubphaseCustom(!!e.subphase && !isKnown)
    setEditNote(e.note || '')
  }

  async function saveEdit(e) {
    const phase = findPhase(editPhaseKey)
    const patch = { phase_key: editPhaseKey, phase_label: phase.label, subphase: editSubphase || null, note: editNote || null }
    const { error } = await sb.from('diary_entries').update(patch).eq('id', e.id)
    if (!error) {
      setEntries(prev => prev.map(x => x.id === e.id ? { ...x, ...patch } : x))
      setEditingId(null)
    } else {
      console.error('saveEdit failed:', error)
      alert('Tallennus epäonnistui.')
    }
  }

  async function deleteEntry(e) {
    if (!window.confirm('Poistetaanko tämä merkintä pysyvästi? Myös kuva poistuu eikä sitä voi palauttaa.')) return
    if (e.photo_path) {
      const { error: rmErr } = await sb.storage.from('diary-photos').remove([e.photo_path])
      if (rmErr) console.error('photo remove failed:', rmErr)
    }
    const { error } = await sb.from('diary_entries').delete().eq('id', e.id)
    if (!error) setEntries(prev => prev.filter(x => x.id !== e.id))
    else { console.error('deleteEntry failed:', error); alert('Poisto epäonnistui.') }
  }

  async function exportPDF() {
    if (entries.length === 0) { alert('Ei vielä merkintöjä tälle työmaalle.'); return }
    setPdfBuilding(true); setPdfProgress({ done: 0, total: entries.length })
    try {
      const { blob, filename } = await buildDiaryPDF({
        projectName: siteLabel, entries, companyName,
        onProgress: (done, total) => setPdfProgress({ done, total }),
      })
      setPdfBlob(blob); setPdfName(filename); setPdfDownloaded(false); setPdfMode(true)
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('PDF:n luonti epäonnistui — tarkista yhteys ja yritä uudelleen.')
    }
    setPdfBuilding(false)
  }

  const shareSupported = typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare
  async function sharePDF() {
    if (!pdfBlob) return
    const file = new File([pdfBlob], pdfName, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: pdfName }) } catch {}
    } else {
      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a'); a.href = url; a.download = pdfName
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 3000)
      setPdfDownloaded(true)
    }
  }

  const groups = groupEntriesByPhase(entries)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 16px', background: '#eef0f2' }}>
        <div style={{ flex: 1, color: '#0d1a6e', fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📔 {siteLabel}</div>
        <button onClick={load} style={{ background: '#fff', border: '1px solid #d0d5e8', color: '#0d1a6e', fontSize: 13, padding: '7px 10px', borderRadius: 20, flexShrink: 0 }}>🔄</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 14px 100px', background: '#f4f6fb' }}>
        {loading && <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6670a0', fontSize: 13.5 }}>Ladataan…</div>}
        {errMsg && <div style={{ textAlign: 'center', color: '#d63030', fontSize: 13, padding: 12 }}>{errMsg}</div>}

        {!loading && entries.length === 0 && !errMsg && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6670a0', fontSize: 13.5, lineHeight: 1.6 }}>
            <div style={{ fontSize: 44, opacity: 0.3, marginBottom: 10 }}>📷</div>
            <p>Ei vielä merkintöjä.<br />Ota ensimmäinen kuva alta ↓</p>
          </div>
        )}

        {!loading && groups.map(({ phase, rows }) => (
          <div key={phase.key} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0d1a6e', background: '#e2e5ee', padding: '8px 12px', borderRadius: 8, marginBottom: 8 }}>{phase.icon} {phase.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(e => (
                <div key={e.id} style={{ background: '#fff', border: '1px solid #d0d5e8', borderRadius: 12, overflow: 'hidden' }}>
                  {editingId === e.id ? (
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <PhaseSubphasePicker
                        phaseKey={editPhaseKey} subphase={editSubphase} custom={editSubphaseCustom}
                        onPhaseChange={setEditPhaseKey} onSubphaseChange={setEditSubphase} onCustomChange={setEditSubphaseCustom}
                      />
                      <textarea style={noteInputStyle} placeholder="Lisätieto" value={editNote} onChange={ev => setEditNote(ev.target.value)} />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditingId(null)} style={ghostBtnStyle}>Peruuta</button>
                        <button onClick={() => saveEdit(e)} style={primaryBtnStyle}>Tallenna</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {e._url && <img src={e._url} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block', background: '#eef0f2' }} />}
                      <div style={{ padding: '10px 12px 12px' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0d1a6e' }}>{e.subphase || '(ei tarkennusta)'}</div>
                        {e.note && <div style={{ fontSize: 13, color: '#333', marginTop: 4, lineHeight: 1.5 }}>{e.note}</div>}
                        <div style={{ fontSize: 11, color: '#9aa2c0', marginTop: 6 }}>
                          {e.created_by_name ? `${e.created_by_name} · ` : ''}
                          🕒 {e.created_at ? new Date(e.created_at).toLocaleString('fi-FI', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                        {canEdit(e) && (
                          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                            <button onClick={() => startEdit(e)} style={linkBtnStyle}>✏️ Muokkaa</button>
                            <button onClick={() => deleteEntry(e)} style={linkBtnStyle}>🗑 Poista</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 480, margin: '0 auto', background: '#eef0f2', borderTop: '1px solid #d0d5e8', padding: '10px 14px env(safe-area-inset-bottom, 14px)', display: 'flex', gap: 8, zIndex: 20 }}>
        <button onClick={openComposer} style={{ flex: 1.3, padding: 13, background: '#070b17', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700 }}>📷 Uusi merkintä</button>
        {canManage && (
          <button onClick={exportPDF} disabled={pdfBuilding} style={{ flex: 1, padding: 13, background: '#fff', border: '1px solid #d0d5e8', borderRadius: 8, color: '#0d1a6e', fontSize: 13, fontWeight: 700, opacity: pdfBuilding ? 0.6 : 1 }}>
            {pdfBuilding ? `Kootaan… ${pdfProgress.done}/${pdfProgress.total}` : '📄 Vie PDF'}
          </button>
        )}
      </div>

      {composerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: '#f4f6fb', zIndex: 100, display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'env(safe-area-inset-top, 12px) 16px 12px', background: '#070b17' }}>
            <button onClick={() => setComposerOpen(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 16 }}>✕</button>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Uusi merkintä</span>
            <span style={{ width: 32 }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ border: '1.5px dashed #b0b8d8', borderRadius: 12, overflow: 'hidden' }}>
              {photoPreview ? (
                <div style={{ position: 'relative' }}>
                  <img src={photoPreview} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', display: 'block' }} />
                  <button onClick={() => { setPhotoBlob(null); setPhotoPreview(null) }} style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 20 }}>✕ Poista kuva</button>
                </div>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '36px 16px', color: '#6670a0', fontSize: 13.5, textAlign: 'center' }}>
                  <div style={{ fontSize: 34 }}>📷</div>
                  <div>Ota kuva / valitse galleriasta</div>
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPickPhoto} />
                </label>
              )}
            </div>

            <PhaseSubphasePicker
              phaseKey={phaseKey} subphase={subphase} custom={subphaseCustom}
              onPhaseChange={setPhaseKey} onSubphaseChange={setSubphase} onCustomChange={setSubphaseCustom}
            />

            <div>
              <div style={labelStyle}>Lisätieto (valinnainen)</div>
              <textarea style={noteInputStyle} placeholder="Tarkempi kuvaus…" value={note} onChange={e => setNote(e.target.value)} />
            </div>

            <button onClick={saveEntry} disabled={saving || !phaseKey} style={{ padding: 13, background: '#070b17', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14.5, fontWeight: 700, opacity: (saving || !phaseKey) ? 0.5 : 1 }}>
              {saving ? 'Tallennetaan…' : 'Tallenna merkintä'}
            </button>
          </div>
        </div>
      )}

      {pdfMode && (
        <div style={{ position: 'fixed', inset: 0, background: '#f4f6fb', zIndex: 100, display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'env(safe-area-inset-top, 12px) 16px 12px', background: '#070b17' }}>
            <button onClick={() => setPdfMode(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 16 }}>✕</button>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>PDF valmis</span>
            <button onClick={sharePDF} style={{ background: '#f5a800', border: 'none', color: '#070b17', fontSize: 12.5, fontWeight: 700, padding: '8px 14px', borderRadius: 8 }}>{shareSupported ? '⬆ Jaa' : '⬇ Lataa PDF'}</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 60 }}>{pdfDownloaded ? '✅' : '📄'}</div>
            {shareSupported ? (
              <p style={{ fontSize: 14, color: '#6670a0', lineHeight: 1.6 }}>Paina <strong style={{ color: '#0d1a6e' }}>Jaa ⬆</strong> avataksesi jakovalikon — esim. sähköpostiin tai asiakkaalle.</p>
            ) : pdfDownloaded ? (
              <p style={{ fontSize: 14, color: '#1a8a50', fontWeight: 600, lineHeight: 1.6 }}>PDF ladattu koneen Lataukset-kansioon.<br /><span style={{ color: '#6670a0', fontWeight: 400 }}>({pdfName})</span></p>
            ) : (
              <p style={{ fontSize: 14, color: '#6670a0', lineHeight: 1.6 }}>Paina <strong style={{ color: '#0d1a6e' }}>Lataa PDF</strong> tallentaaksesi tiedoston koneelle.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Kaksitasoinen työvaihevalinta: ensin pääotsikko (esim. "7. Runko"), sitten
// sen alle listatut tarkennukset — tai vapaa teksti jos "✏️ Muu" valitaan.
function PhaseSubphasePicker({ phaseKey, subphase, custom, onPhaseChange, onSubphaseChange, onCustomChange }) {
  const phase = findPhase(phaseKey)
  const hasSubphases = phase.subphases && phase.subphases.length > 0

  function handlePhaseChange(key) {
    onPhaseChange(key)
    onSubphaseChange('')
    onCustomChange(false)
  }

  function handleSubSelect(val) {
    if (val === '__custom__') { onCustomChange(true); onSubphaseChange('') }
    else { onCustomChange(false); onSubphaseChange(val) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={labelStyle}>Työvaihe</div>
        <select style={selectStyle} value={phaseKey} onChange={e => handlePhaseChange(e.target.value)}>
          <option value="" disabled>Valitse työvaihe…</option>
          {ALL_PHASES.map(p => <option key={p.key} value={p.key}>{p.icon} {p.label}</option>)}
        </select>
      </div>

      {phaseKey && (
        <div>
          <div style={labelStyle}>Tarkennus</div>
          {!custom ? (
            <select style={selectStyle} value={subphase} onChange={e => handleSubSelect(e.target.value)}>
              <option value="" disabled>{hasSubphases ? 'Valitse tarkennus…' : 'Ei tarkennuksia tälle vaiheelle'}</option>
              {phase.subphases.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="__custom__">✏️ Muu (kirjoita itse)</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...selectStyle, flex: 1 }} autoFocus placeholder="Kirjoita tarkennus" value={subphase} onChange={e => onSubphaseChange(e.target.value)} />
              <button onClick={() => { onCustomChange(false); onSubphaseChange('') }} style={ghostBtnStyle}>Listaan</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 10.5, fontWeight: 700, color: '#6670a0', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 5 }
const selectStyle = { background: '#fff', border: '1px solid #d0d5e8', borderRadius: 8, color: '#0d1a6e', fontSize: 14, padding: '9px 12px', width: '100%', outline: 'none' }
const noteInputStyle = { ...selectStyle, minHeight: 70, resize: 'vertical' }
const ghostBtnStyle = { background: '#eef0f2', border: '1px solid #d0d5e8', borderRadius: 8, color: '#6670a0', fontSize: 13, fontWeight: 700, padding: '9px 14px' }
const primaryBtnStyle = { background: '#070b17', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 16px' }
const linkBtnStyle = { background: 'none', border: 'none', fontSize: 12, color: '#6670a0', fontWeight: 600, padding: '4px 0' }
