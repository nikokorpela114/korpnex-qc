// src/PaalutusView.jsx
// Paalutajien oma näkymä — TÄYSIN ERILLINEN InstallerView.jsx:stä (eri
// käyttäjäryhmä, eri kirjautuminen: pile_operators-taulu, ei installers).
// Avataan osoitteella ?paalutus.
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { sb } from './supabaseClient.js'
import { latLngToTM35FIN } from './coords.js'
import AuthGate from './AuthGate.jsx'

// Huonompia GPS-lukemia kuin tämä (metrejä) ei käytetä sijainnin
// päivittämiseen — ensimmäiset watchPosition-lukemat ja metallirakenteiden
// alla otetut lukemat voivat olla kymmeniä-satoja metrejä pielessä.
const MAX_GPS_ACCURACY_M = 20

// Järjestää rivin paalut niiden todellisen pääsuunnan mukaan (PCA/
// regressiosuora), ei kiinteän x- tai y-akselin mukaan. Pelkkä x- tai
// y-akseli toimii vain jos rivi on lähes suoraan itä-länsi tai pohjois-etelä
// — vinolle tai kaartuvalle riville se sekoittaa järjestyksen, koska pisteet
// voivat edetä molemmilla akseleilla samaan aikaan. PCA:lla laskettu
// pääsuunta seuraa rivin todellista kulkua kaikissa kulmissa, ja täysin
// suoralle länsi-itä/pohjois-etelä-riville tulos on identtinen vanhaan
// akselipohjaiseen lajitteluun verrattuna.
export function orderPilesAlongRow(data) {
  if (data.length < 2) return [...data]
  const n = data.length
  const mx = data.reduce((s, p) => s + p.x, 0) / n
  const my = data.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, syy = 0, sxy = 0
  data.forEach(p => {
    const dx = p.x - mx, dy = p.y - my
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy
  })
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dirX = Math.cos(angle), dirY = Math.sin(angle)
  // Suunta pidetään samana kuin aiemmassa logiikassa: pääosin itä-länsi
  // riveillä edetään lännestä itään, pääosin pohjois-etelä riveillä
  // pohjoisesta etelään.
  if (sxx >= syy) {
    if (dirX < 0) { dirX = -dirX; dirY = -dirY }
  } else if (dirY > 0) {
    dirX = -dirX; dirY = -dirY
  }
  return [...data].sort((a, b) => (a.x * dirX + a.y * dirY) - (b.x * dirX + b.y * dirY))
}

export const PILE_TYPES = [
  { code: 'A', label: 'A — 2500×100' },
  { code: 'B', label: 'B — 2500×150' },
  { code: 'BB', label: 'BB — 2500×250' },
  { code: 'C', label: 'C — 3000×100' },
  { code: 'D', label: 'D — 3500×100' },
  { code: 'E', label: 'E — 3500×150' },
  { code: 'EE', label: 'EE — 3500×250' },
  { code: 'F', label: 'F — 4000×150' },
  { code: 'G', label: 'G — 4500×100' },
  { code: 'H', label: 'H — 5000×300' },
  { code: 'I', label: 'I — 5000×150 (+jatko 2500)' },
]

export const EXTRA_ACTIONS = [
  { code: '', label: 'Ei lisätoimenpidettä' },
  { code: 'jatkopala_1650', label: 'Jatkopala 1650 mm' },
  { code: 'jatkopala_2200', label: 'Jatkopala 2200 mm' },
  { code: 'ankkurointi', label: 'Ankkurointi kallioon/kiveen + 1,45 m putki' },
  { code: 'katkaisu', label: 'Paalun katkaisu ja reikien teko' },
  { code: 'vaihto', label: 'Paalun vaihto' },
  { code: 'kiven_poisto', label: 'Pienen kiven poisto' },
]

export function extraLabel(code) {
  return EXTRA_ACTIONS.find(e => e.code === code)?.label || code || ''
}
export function typeLabel(code) {
  return PILE_TYPES.find(t => t.code === code)?.label || code || ''
}

// Pieni suhteellinen kartta rivin paaluista — pohjoinen ylöspäin (maailman
// Y kasvaa pohjoiseen), säilyttää oikean kuvasuhteen (rivi on yleensä pitkä
// ja kapea). Paalu numeroitu samalla numerolla kuin listassa alla, väritetty
// tilan mukaan, ja tapista voi avata saman muokkauksen kuin listasta.
function RowMiniMap({ piles, editingId, onSelect, myLocation, gpsAccuracy }) {
  const scrollRef = useRef(null)
  const [followMe, setFollowMe] = useState(true) // oletuksena päällä — vierittää automaattisesti omaan sijaintiin

  const hasPiles = !!(piles && piles.length > 0)
  const xs = hasPiles ? piles.map(p => p.x) : [0]
  const ys = hasPiles ? piles.map(p => p.y) : [0]
  // Näytetään oma sijainti kartalla vain jos se on riittävän lähellä riviä
  // (esim. 300m sisällä) — muuten se venyttäisi koko kartan valtaosin
  // tyhjäksi tilaksi jos GPS-piste on kaukana (esim. testatessa sisällä).
  const MAX_LOCATION_DIST_M = 300
  let showLocation = false
  if (hasPiles && myLocation) {
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const dist = Math.hypot(myLocation.x - cx, myLocation.y - cy)
    if (dist <= MAX_LOCATION_DIST_M) {
      showLocation = true
      xs.push(myLocation.x); ys.push(myLocation.y)
    }
  }
  const nearestPile = (hasPiles && myLocation) ? piles.reduce((best, p) => {
    const d = Math.hypot(p.x - myLocation.x, p.y - myLocation.y)
    return (!best || d < best.d) ? { p, d } : best
  }, null) : null

  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)

  // Todenmukainen mittakaava (px/metri) — EI venytetä täyttämään laatikkoa,
  // koska rivi on hyvin pitkä (esim. 100 m) ja kapea (n. 2-3 m): täyttöön
  // venytetty kuva menisi aina paalut päällekkäin. Sen sijaan piirretään
  // oikeassa suhteessa ja annetaan leveän rivin vierittyä sivusuunnassa.
  const PX_PER_M = 14
  const pad = 24
  const drawW = spanX * PX_PER_M
  const drawH = spanY * PX_PER_M
  const boxW = Math.max(320, drawW + pad * 2)
  const boxH = Math.max(140, drawH + pad * 2)
  const offX = pad
  const offY = pad + Math.max(0, (boxH - pad * 2 - drawH) / 2)

  const tx = x => offX + (x - minX) * PX_PER_M
  const ty = y => offY + (drawH - (y - minY) * PX_PER_M) // pohjoinen (suurempi Y) ylöspäin

  const editingPile = hasPiles ? piles.find(p => p.id === editingId) : null
  const editingIdx = editingPile ? piles.indexOf(editingPile) : -1

  // "Seuraa sijaintia" -tila: vierittää kartan automaattisesti niin että
  // oma GPS-sijainti pysyy näkyvissä liikkuessa pitkän rivin vieressä —
  // ei tarvitse itse pyyhkäistä karttaa koko ajan. Käyttäjän oma
  // vieritys (onScroll alla) sammuttaa tämän, "🎯"-nappi käynnistää sen
  // uudelleen. Hook kutsutaan aina (ei ehdollisesti) — sisällä ohitetaan
  // jos ei ole vielä dataa/sijaintia.
  useEffect(() => {
    if (!hasPiles || !followMe || !showLocation) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: Math.max(0, tx(myLocation.x) - el.clientWidth / 2), behavior: 'smooth' })
  }, [followMe, hasPiles, showLocation, myLocation?.x, myLocation?.y])

  if (!hasPiles) return null

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={scrollRef}
        onWheel={() => setFollowMe(false)}
        onTouchMove={() => setFollowMe(false)}
        style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 260, overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', marginBottom: 12, borderRadius: 8, background: '#eef4ec' }}
      >
        <svg viewBox={`0 0 ${boxW} ${boxH}`} width={boxW} height={boxH} style={{ display: 'block' }}>
          <text x={boxW - 8} y={16} textAnchor="end" fontSize="11" fill="#666">N ↑</text>
          {piles.map((p, idx) => {
            const isEditing = editingId === p.id
            const hasPullTest = p.pull_test_kn != null
            const color = p.status === 'done' ? '#1a7a45' : '#999'
            return (
              <g key={p.id} onClick={() => onSelect(p)} style={{ cursor: 'pointer' }}>
                {isEditing && <circle cx={tx(p.x)} cy={ty(p.y)} r={9} fill="none" stroke="#1560c4" strokeWidth={2} />}
                {hasPullTest && <circle cx={tx(p.x)} cy={ty(p.y)} r={8} fill="none" stroke="#d63030" strokeWidth={2} />}
                <circle cx={tx(p.x)} cy={ty(p.y)} r={5} fill={color} stroke="#fff" strokeWidth={1} />
              </g>
            )
          })}
          {editingIdx >= 0 && (
            <text x={tx(editingPile.x)} y={ty(editingPile.y) - 13} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#1560c4">
              #{editingIdx + 1}
            </text>
          )}
          {showLocation && (
            <g>
              {/* Punainen poikkiviiva koko kartan korkeudelta oman sijainnin
                  x-kohdalla — näkyy selvästi kumpaa kautta tahansa (pohjois-
                  tai eteläpuolelta) riviä lähestytään, ja osoittaa suoraan
                  minkä paaluparin kohdalla kone on. */}
              <line x1={tx(myLocation.x)} y1={0} x2={tx(myLocation.x)} y2={boxH} stroke="#e03131" strokeWidth={2.5} strokeDasharray="5 4" />
              <circle cx={tx(myLocation.x)} cy={ty(myLocation.y)} r={4} fill="#e03131" stroke="#fff" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      </div>
      {gpsAccuracy != null && (
        <div
          title="GPS-sijainnin tarkkuus juuri nyt"
          style={{
            position: 'absolute', bottom: 8, left: 8, zIndex: 10,
            fontSize: 11, padding: '3px 8px', borderRadius: 6,
            background: gpsAccuracy > MAX_GPS_ACCURACY_M ? 'rgba(214,48,48,0.12)' : 'rgba(26,122,69,0.12)',
            color: gpsAccuracy > MAX_GPS_ACCURACY_M ? '#b42318' : '#1a7a45',
            border: `1px solid ${gpsAccuracy > MAX_GPS_ACCURACY_M ? '#e8a3a3' : '#a8d5bb'}`,
          }}
        >
          GPS ±{Math.round(gpsAccuracy)} m{gpsAccuracy > MAX_GPS_ACCURACY_M ? ' — liian epätarkka' : ''}
          {nearestPile ? ` · lähin paalu ${nearestPile.d.toFixed(0)} m` : ''}
        </div>
      )}
      {showLocation && (
        <button
          onClick={() => setFollowMe(f => !f)}
          title="Seuraa sijaintia"
          style={{
            position: 'absolute', bottom: 8, right: 8, zIndex: 10,
            width: 32, height: 32, borderRadius: 7, fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: followMe ? '1px solid #1560c4' : '1px solid #ccc',
            background: followMe ? '#1560c4' : 'rgba(255,255,255,0.92)',
            color: followMe ? '#fff' : '#333',
          }}
        >
          📍
        </button>
      )}
    </div>
  )
}

// Rakentaa rivin PDF- ja Excel-tiedostot (blobit) — jaettu funktio jota
// käyttävät sekä paaluttajan vientinappi (jakaa puhelimen jakovalikolla)
// että valvomon latausnappi (suora lataus, ei jakovalikkoa työpöydällä).
export async function buildRowExportFiles(rowPiles, areaLabel, rowNumber, siteLabel) {
  const doneCount = rowPiles.filter(p => p.status === 'done').length
  const isPartial = doneCount < rowPiles.length
  const rowLabel = `${areaLabel} rivi ${rowNumber}${isPartial ? ' (KESKEN)' : ''}`
  const dateStr = new Date().toLocaleDateString('fi-FI')
  const baseName = `${siteLabel} - ${rowLabel} - ${dateStr}`.replace(/\s+/g, '_')

  // Excel (.xlsx) — vetotestatut paalut punaisella solutaustalla
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(rowLabel.slice(0, 31))
  ws.columns = [
    { header: 'Paalu #', key: 'idx', width: 8 },
    { header: 'Paalukoko', key: 'type', width: 18 },
    { header: 'Lisätoimenpide', key: 'extra', width: 30 },
    { header: 'Vetotesti (kN)', key: 'kn', width: 14 },
    { header: 'Asentaja', key: 'by', width: 16 },
    { header: 'Aika', key: 'at', width: 18 },
  ]
  ws.getRow(1).font = { bold: true }
  const redFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7D6D6' } }
  rowPiles.forEach((p, idx) => {
    const row = ws.addRow({
      idx: idx + 1,
      type: typeLabel(p.pile_type),
      extra: extraLabel(p.extra_action),
      kn: p.pull_test_kn ?? '',
      by: p.installed_by || '',
      at: p.installed_at ? new Date(p.installed_at).toLocaleString('fi-FI') : '',
    })
    if (p.pull_test_kn != null) row.eachCell(c => { c.fill = redFill })
  })
  const xlsxBuffer = await wb.xlsx.writeBuffer()
  const xlsxBlob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  // PDF — vetotestatut paalut punaisella tekstillä
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFontSize(14)
  doc.text(`${siteLabel} — ${rowLabel}`, 14, 16)
  doc.setFontSize(10)
  doc.text(`Pvm: ${dateStr}`, 14, 23)
  if (isPartial) {
    doc.setTextColor(180, 100, 0)
    doc.text(`Kesken — ${doneCount}/${rowPiles.length} paalua merkitty`, 14, 27)
    doc.setTextColor(0, 0, 0)
  }

  // Karttakuva (vektorina, samassa hengessä kuin puhelimen rivikartta) —
  // sovitetaan laatikkoon (ei vieritystä paperilla), säilyttää oikean
  // kuvasuhteen. Punainen rengas = vetotesti tehty.
  let y = isPartial ? 33 : 30
  const mapX = 14, mapW = 182, mapH = 62
  doc.setDrawColor(200, 205, 220)
  doc.setFillColor(238, 244, 236)
  doc.rect(mapX, y, mapW, mapH, 'FD')
  const mxs = rowPiles.map(p => p.x), mys = rowPiles.map(p => p.y)
  const mMinX = Math.min(...mxs), mMaxX = Math.max(...mxs)
  const mMinY = Math.min(...mys), mMaxY = Math.max(...mys)
  const mSpanX = Math.max(mMaxX - mMinX, 1), mSpanY = Math.max(mMaxY - mMinY, 1)
  const mPad = 4
  const mScale = Math.min((mapW - mPad * 2) / mSpanX, (mapH - mPad * 2) / mSpanY)
  const mDrawW = mSpanX * mScale, mDrawH = mSpanY * mScale
  const mOffX = mapX + mPad + (mapW - mPad * 2 - mDrawW) / 2
  const mOffY = y + mPad + (mapH - mPad * 2 - mDrawH) / 2
  const mtx = px => mOffX + (px - mMinX) * mScale
  const mty = py => mOffY + (mDrawH - (py - mMinY) * mScale) // pohjoinen ylös
  // Pohjoisnuoli piirretään viivoilla, ei unicode-nuolimerkillä — jsPDF:n
  // oletusfontti ei tue "↑"-merkkiä ja se piirtyi aiemmin roskamerkkeinä.
  doc.setFontSize(7); doc.setTextColor(120, 120, 120)
  const nx = mapX + mapW - 10, ny = y + 7
  doc.text('N', nx, ny, { align: 'center' })
  doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3)
  doc.line(nx, ny - 2.2, nx, ny - 6)
  doc.line(nx, ny - 6, nx - 1, ny - 4.3)
  doc.line(nx, ny - 6, nx + 1, ny - 4.3)
  doc.setLineWidth(0.2)

  // Esilasketaan pisteiden sijainnit ja tunnistetaan pystysuunnassa
  // päällekkäiset parit (esim. paalu + tukipaalu samassa kohdassa), jotta
  // numero piirretään ylemmälle pisteelle yläpuolelle ja alemmalle
  // alapuolelle — muuten alemman numero peittyi ylemmän pisteen alle.
  const pts = rowPiles.map(p => ({ p, cx: mtx(p.x), cy: mty(p.y) }))
  const xBucket = new Map()
  pts.forEach(pt => {
    const key = Math.round(pt.cx / 1.2)
    if (!xBucket.has(key)) xBucket.set(key, [])
    xBucket.get(key).push(pt)
  })
  pts.forEach(pt => {
    const key = Math.round(pt.cx / 1.2)
    const group = xBucket.get(key)
    pt.labelAbove = group.length <= 1 || group.slice().sort((a, b) => a.cy - b.cy)[0] === pt
  })
  pts.forEach((pt, idx) => {
    const { p, cx, cy } = pt
    if (p.status === 'done') doc.setFillColor(26, 122, 69); else doc.setFillColor(153, 153, 153)
    doc.circle(cx, cy, 0.7, 'F')
    if (p.pull_test_kn != null) { doc.setDrawColor(214, 48, 48); doc.setLineWidth(0.25); doc.circle(cx, cy, 1.2, 'S') }
    doc.setFontSize(3.2); doc.setTextColor(70, 70, 70)
    doc.text(String(idx + 1), cx, pt.labelAbove ? cy - 1.6 : cy + 2.8, { align: 'center' })
  })
  doc.setLineWidth(0.2)
  y += mapH + 8

  doc.setFontSize(9)
  doc.setTextColor(0, 0, 0)
  doc.text('#', 14, y); doc.text('Koko', 24, y); doc.text('Lisätoimenpide', 50, y)
  doc.text('Vetotesti kN', 110, y); doc.text('Asentaja', 140, y)
  y += 5
  doc.line(14, y - 3, 196, y - 3)
  rowPiles.forEach((p, idx) => {
    if (y > 280) { doc.addPage(); y = 16 }
    const hasPullTest = p.pull_test_kn != null
    doc.setTextColor(hasPullTest ? 214 : 0, hasPullTest ? 48 : 0, hasPullTest ? 48 : 0)
    doc.text(String(idx + 1), 14, y)
    doc.text(typeLabel(p.pile_type) || '-', 24, y)
    doc.text(extraLabel(p.extra_action) || '-', 50, y, { maxWidth: 58 })
    doc.text(p.pull_test_kn != null ? String(p.pull_test_kn) : '-', 110, y)
    doc.text(p.installed_by || '-', 140, y)
    y += 6
  })
  doc.setTextColor(0, 0, 0)
  const pdfBlob = doc.output('blob')

  return { pdfBlob, xlsxBlob, baseName, rowLabel }
}

// Paaluttajan kirjautuminen on jaettu AuthGate (src/AuthGate.jsx) — sama
// komponentti kuin Valvomossa/asentajalla. Vanha nimi+PIN-valinta on
// poistunut kokonaan.
export default function PaalutusView() {
  return (
    <AuthGate allowedRoles={['paaluttaja', 'admin']} title="Paalutus">
      {({ session, profile, logout }) => <PaalutusApp session={session} profile={profile} logout={logout} />}
    </AuthGate>
  )
}

function PaalutusApp({ session, profile, logout }) {
  // Ensikirjautumisella luodaan automaattisesti pile_operators-rivi jonka
  // id = auth.uid() — ks. sama kuvio InstallerView.jsx:ssä.
  const [operator, setOperator] = useState(undefined)
  const [provisionErr, setProvisionErr] = useState('')
  const [sites, setSites] = useState([])

  const [siteId, setSiteId] = useState('')
  const [rowSummary, setRowSummary] = useState(null) // null = ladataan, kaikki alueet+rivit tälle työmaalle
  const [selectedArea, setSelectedArea] = useState(null)
  const [selectedRow, setSelectedRow] = useState(null)
  const [rowPiles, setRowPiles] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [formType, setFormType] = useState('')
  const [formCustomType, setFormCustomType] = useState('')
  const [formExtra, setFormExtra] = useState('')
  const [formKn, setFormKn] = useState('')
  const [saving, setSaving] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [myLocation, setMyLocation] = useState(null)

  // GPS-seuranta vain kun rivinäkymä on auki (säästää akkua muualla).
  // HUOM: ensimmäiset watchPosition-lukemat voivat olla hyvin epätarkkoja
  // (kymmeniä-satoja metrejä pielessä) ennen kuin GPS-lukitus tarkentuu, ja
  // metallirakenteiden alla seisominen heikentää tarkkuutta entisestään.
  // Hylätään lukemat joiden accuracy on huono, jottei
  // kartalla näytetä harhaanjohtavan tarkkaa mutta väärää sijaintia.
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  useEffect(() => {
    if (selectedRow == null || !navigator.geolocation) return
    const watcher = navigator.geolocation.watchPosition(pos => {
      setGpsAccuracy(pos.coords.accuracy)
      if (pos.coords.accuracy > MAX_GPS_ACCURACY_M) return
      const { x, y } = latLngToTM35FIN(pos.coords.latitude, pos.coords.longitude)
      setMyLocation({ x, y, accuracy: pos.coords.accuracy })
    }, () => {}, { enableHighAccuracy: true })
    return () => navigator.geolocation.clearWatch(watcher)
  }, [selectedRow])

  // Varmistaa että kirjautuneella auth-käyttäjällä on pile_operators-rivi
  // jonka id = auth.uid(). Vanhoilla nimi+PIN-ajan riveillä ei ollut
  // yhteyttä oikeisiin Auth-tileihin, niin uusi rivi luodaan aina
  // ensimmäisellä kirjautumisella.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: existing, error } = await sb.from('pile_operators').select('*').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      if (error) { setProvisionErr(error.message); return }
      if (existing) { setOperator(existing); return }
      const name = profile.name || session.user.email
      const { data: created, error: insErr } = await sb.from('pile_operators')
        .insert([{ id: session.user.id, name, company_id: profile.company_id }])
        .select().single()
      if (cancelled) return
      if (insErr) { setProvisionErr(insErr.message); return }
      setOperator(created)
    })()
    return () => { cancelled = true }
  }, [session.user.id, profile.company_id, profile.name, session.user.email])

  // Yrityksen työmaat DB:stä (korvaa vanhan kovakoodatun KNOWN_SITES-listan).
  useEffect(() => {
    sb.from('sites').select('*').order('label').then(({ data }) => {
      setSites(data || [])
      if ((data || []).length && !siteId) setSiteId(data[0].id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Rivilistan lataus (kaikki alueet+rivit kerralla tälle työmaalle) ---
  const loadRowSummary = useCallback(() => {
    if (!siteId) return
    setRowSummary(null)
    sb.from('pile_rows_summary').select('*').eq('site', siteId).order('area').order('row_number').then(({ data, error }) => {
      setRowSummary(error ? [] : (data || []))
    })
  }, [siteId])

  useEffect(() => {
    if (operator && siteId) loadRowSummary()
  }, [operator, siteId, loadRowSummary])

  useEffect(() => { setSelectedArea(null); setSelectedRow(null) }, [siteId])

  // Alueiden yhteenveto lasketaan rowSummary:sta (ei erillistä kyselyä)
  const areaSummary = React.useMemo(() => {
    if (!rowSummary) return null
    const byArea = new Map()
    for (const r of rowSummary) {
      if (!byArea.has(r.area)) byArea.set(r.area, { area: r.area, rows: 0, rowsDone: 0, total: 0, done: 0 })
      const a = byArea.get(r.area)
      a.rows += 1
      if (r.row_complete) a.rowsDone += 1
      a.total += r.total_piles
      a.done += r.done_piles
    }
    return [...byArea.values()].sort((a, b) => a.area.localeCompare(b.area))
  }, [rowSummary])

  // --- Yksittäisen rivin paalujen lataus (aina alueen sisällä) ---
  function openRow(rowNumber) {
    setSelectedRow(rowNumber)
    setRowPiles(null)
    setEditingId(null)
    sb.from('piles').select('*').eq('site', siteId).eq('area', selectedArea).eq('row_number', rowNumber).order('id')
      .then(({ data, error }) => {
        if (error || !data) { setRowPiles([]); return }
        // HUOM: tietokannan järjestys on DXF:n piirtojärjestys, EI fyysinen
        // sijainti — ilman tätä "Paalu #3" ja "Paalu #67" voisivat olla
        // vierekkäin kartalla, mikä on hämmentävää. Järjestetään rivin
        // todellisen pääsuunnan (PCA/regressiosuora) mukaan, EI pelkän x- tai
        // y-akselin mukaan — pelkkä akselivalinta rikkoo järjestyksen vinoilla
        // tai kaartuvilla riveillä (piste voi "hypätä" edestakaisin), kun taas
        // pääsuunta toimii oikein sekä suorille että vinoille riveille.
        setRowPiles(orderPilesAlongRow(data))
      })
  }

  function closeRow() {
    setSelectedRow(null)
    setRowPiles(null)
    setEditingId(null)
    loadRowSummary()
  }

  function closeArea() {
    setSelectedArea(null)
    setSelectedRow(null)
    setRowPiles(null)
  }

  // Lataa tallennetun paalukoon lomakkeeseen — jos arvo ei täsmää mihinkään
  // vakiokokoon (A-I), se on aiemmin kirjoitettu vapaa teksti ("Jokin muu").
  function applyPileTypeToForm(pileType) {
    if (pileType && !PILE_TYPES.find(t => t.code === pileType)) {
      setFormType('__muu__')
      setFormCustomType(pileType)
    } else {
      setFormType(pileType || '')
      setFormCustomType('')
    }
  }

  function startEdit(pile) {
    setEditingId(pile.id)
    applyPileTypeToForm(pile.pile_type)
    setFormExtra(pile.extra_action || '')
    setFormKn(pile.pull_test_kn ?? '')
  }

  // Kopioi lomakkeeseen lähimmän EDELLISEN (rivijärjestyksessä taaksepäin)
  // jo merkityn paalun tiedot — nopeuttaa kun peräkkäiset paalut ovat samaa.
  function copyPrevious(pileId) {
    const idx = rowPiles.findIndex(p => p.id === pileId)
    for (let i = idx - 1; i >= 0; i--) {
      if (rowPiles[i].status === 'done') {
        applyPileTypeToForm(rowPiles[i].pile_type)
        setFormExtra(rowPiles[i].extra_action || '')
        setFormKn(rowPiles[i].pull_test_kn ?? '')
        return
      }
    }
    alert('Ei aiempaa merkittyä paalua tällä rivillä.')
  }

  async function savePile(pileId) {
    if (formType === '__muu__' && !formCustomType.trim()) { alert('Kirjoita paalukoko tekstikenttään'); return }
    const finalType = formType === '__muu__' ? formCustomType.trim() : formType
    setSaving(true)
    const { data, error } = await sb.from('piles').update({
      pile_type: finalType || null,
      extra_action: formExtra || null,
      pull_test_kn: formKn === '' ? null : parseFloat(formKn),
      status: 'done',
      installed_by: operator?.name || session.user.email,
      installed_at: new Date().toISOString()
    }).eq('id', pileId).select().single()
    setSaving(false)
    if (!error && data) {
      setRowPiles(prev => prev.map(p => p.id === pileId ? data : p))
      setEditingId(null)
    } else {
      alert('Tallennus epäonnistui, tarkista verkkoyhteys.')
    }
  }

  // --- Vienti PDF + CSV kun rivi valmis ---
  async function exportRow() {
    if (!rowPiles || rowPiles.length === 0) return
    setExportMsg('Luodaan tiedostoja...')
    const siteLabel = sites.find(s => s.id === siteId)?.label || siteId
    const { pdfBlob, xlsxBlob, baseName, rowLabel } = await buildRowExportFiles(rowPiles, selectedArea, selectedRow, siteLabel)

    // Jaa puhelimen omalla jakovalikolla (sama tapa kuin valvomon PDF-jaossa
    // App.jsx:ssä) — huomattavasti nopeampi ja luotettavampi kuin lataus-
    // linkit, erityisesti iOS Safarissa jossa <a download> toimii huonosti.
    const pdfFile = new File([pdfBlob], `${baseName}.pdf`, { type: 'application/pdf' })
    const xlsxFile = new File([xlsxBlob], `${baseName}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    if (navigator.canShare?.({ files: [pdfFile, xlsxFile] })) {
      try {
        await navigator.share({ files: [pdfFile, xlsxFile], title: rowLabel })
        setExportMsg('✅ Lähetetty.')
      } catch {
        setExportMsg('')
      }
    } else {
      // Varalla, jos jakotoiminto ei ole tuettu: lataus
      for (const [blob, name] of [[pdfBlob, `${baseName}.pdf`], [xlsxBlob, `${baseName}.xlsx`]]) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = name
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 3000)
      }
      setExportMsg('✅ PDF ja Excel ladattu — lähetä ne työnjohdolle esim. sähköpostilla tai WhatsAppilla.')
    }
  }

  // --- Ensikirjautuminen kesken: luodaan pile_operators-rivi automaattisesti ---
  if (operator === undefined) {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto', padding: 20, fontFamily: 'sans-serif', textAlign: 'center' }}>
        {provisionErr ? (
          <>
            <p style={{ color: '#b02828' }}>Virhe tilin valmistelussa: {provisionErr}</p>
            <button onClick={logout} style={{ padding: '10px 18px', background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 'bold' }}>Kirjaudu ulos</button>
          </>
        ) : (
          <p style={{ color: '#666' }}>Ladataan…</p>
        )}
      </div>
    )
  }

  // --- Yksittäisen rivin näkymä ---
  if (selectedRow != null) {
    const doneCount = rowPiles ? rowPiles.filter(p => p.status === 'done').length : 0
    const allDone = rowPiles && rowPiles.length > 0 && doneCount === rowPiles.length
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'sans-serif', paddingBottom: 80 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <button onClick={closeRow} style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, background: '#fff' }}>
            ← Takaisin riveihin
          </button>
          <button
            onClick={() => setRowPiles(prev => prev ? [...prev].reverse() : prev)}
            title="Vaihda mistä päästä numerointi alkaa"
            style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, background: '#fff' }}
          >
            ↔ Käännä suunta
          </button>
        </div>
        <h2>{selectedArea} — rivi {selectedRow}</h2>
        {rowPiles == null ? <p>Ladataan...</p> : (
          <>
            <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#f7f8fb', paddingTop: 4, paddingBottom: 4 }}>
              <RowMiniMap piles={rowPiles} editingId={editingId} onSelect={p => editingId === p.id ? setEditingId(null) : startEdit(p)} myLocation={myLocation} gpsAccuracy={gpsAccuracy} />
              <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>🔴 punainen rinkula = vetotesti tehty</div>
            </div>
            <p style={{ color: '#666' }}>{doneCount} / {rowPiles.length} paalua merkitty</p>
            {rowPiles.map((p, idx) => (
              <div key={p.id} style={{
                border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8,
                background: p.status === 'done' ? '#e8f5e9' : '#fff'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => editingId === p.id ? setEditingId(null) : startEdit(p)}>
                  <div>
                    <b>Paalu #{idx + 1}</b>
                    {p.status === 'done' && (
                      <div style={{ fontSize: 13, color: '#1a7a45' }}>
                        {typeLabel(p.pile_type)}{p.extra_action ? ` · ${extraLabel(p.extra_action)}` : ''}{p.pull_test_kn != null ? ` · ${p.pull_test_kn} kN` : ''}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 20 }}>{p.status === 'done' ? '✅' : '⬜'}</span>
                </div>

                {editingId === p.id && (
                  <div style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10 }}>
                    <button onClick={() => copyPrevious(p.id)}
                      style={{ width: '100%', padding: 8, marginBottom: 10, fontSize: 13, background: '#eef1ff', color: '#1560c4', border: '1px solid #c7cdf5', borderRadius: 6 }}>
                      ↺ Kopioi edellinen
                    </button>

                    <label style={{ fontSize: 13, fontWeight: 'bold' }}>Paalukoko</label>
                    <select value={formType} onChange={e => setFormType(e.target.value)}
                      style={{ width: '100%', padding: 8, fontSize: 15, marginBottom: formType === '__muu__' ? 8 : 8 }}>
                      <option value="">Valitse...</option>
                      {PILE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                      <option value="__muu__">Jokin muu…</option>
                    </select>
                    {formType === '__muu__' && (
                      <input type="text" value={formCustomType} onChange={e => setFormCustomType(e.target.value)}
                        placeholder="Kirjoita paalukoko, esim. 2800×120"
                        style={{ width: '100%', padding: 8, fontSize: 15, marginBottom: 8 }} />
                    )}

                    <label style={{ fontSize: 13, fontWeight: 'bold' }}>Lisätoimenpide</label>
                    <select value={formExtra} onChange={e => setFormExtra(e.target.value)}
                      style={{ width: '100%', padding: 8, fontSize: 15, marginBottom: 8 }}>
                      {EXTRA_ACTIONS.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
                    </select>

                    <label style={{ fontSize: 13, fontWeight: 'bold' }}>Vetotesti (kN)</label>
                    <input type="number" inputMode="decimal" value={formKn} onChange={e => setFormKn(e.target.value)}
                      style={{ width: '100%', padding: 8, fontSize: 15, marginBottom: 10 }} />

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setFormType(''); setFormCustomType(''); setFormExtra(''); setFormKn('') }}
                        style={{ flex: 1, padding: 10, fontWeight: 'bold', background: '#fff', color: '#666', border: '1px solid #ccc', borderRadius: 6 }}>
                        ✕ Tyhjennä
                      </button>
                      <button onClick={() => savePile(p.id)} disabled={saving}
                        style={{ flex: 2, padding: 10, fontWeight: 'bold', background: '#1a7a45', color: '#fff', border: 'none', borderRadius: 6 }}>
                        {saving ? 'Tallennetaan...' : '✓ Tallenna'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {doneCount > 0 && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: '#fff', borderTop: '1px solid #ddd' }}>
            <button onClick={exportRow}
              style={{ width: '100%', maxWidth: 480, margin: '0 auto', display: 'block', padding: 14, fontSize: 16, fontWeight: 'bold', background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8 }}>
              {allDone ? '📤 Rivi valmis — vie PDF + Excel' : `📤 Vie osittainen rivi (${doneCount}/${rowPiles.length}) — PDF + Excel`}
            </button>
            {!allDone && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#999', marginTop: 4 }}>
                Loput paalut säilyvät merkitsemättöminä — kuka tahansa voi jatkaa riviä myöhemmin.
              </p>
            )}
            {exportMsg && <p style={{ textAlign: 'center', fontSize: 13, marginTop: 6 }}>{exportMsg}</p>}
          </div>
        )}
      </div>
    )
  }

  // --- Aluevalintanäkymä ---
  if (selectedArea == null) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Paalutus — {operator.name}</h2>
          <button onClick={logout} style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', fontSize: 13 }}>
            Kirjaudu ulos
          </button>
        </div>

        <select value={siteId} onChange={e => setSiteId(e.target.value)}
          style={{ width: '100%', padding: 8, fontSize: 15, marginBottom: 12 }}>
          {sites.length === 0 && <option value="">Ei työmaita</option>}
          {sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        {areaSummary == null ? <p>Ladataan alueita...</p> :
          areaSummary.length === 0 ? <p>Ei paalutietoja tälle työmaalle. Onko tuonti (?paalutuonti) ajettu?</p> :
          areaSummary.map(a => {
            const complete = a.rowsDone === a.rows
            return (
              <div key={a.area} onClick={() => setSelectedArea(a.area)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 14, marginBottom: 6, borderRadius: 8, cursor: 'pointer',
                  background: complete ? '#e8f5e9' : '#f7f7f7', border: '1px solid #e0e0e0'
                }}>
                <b>{a.area}</b>
                <span style={{ color: complete ? '#1a7a45' : '#666', fontSize: 14 }}>
                  {a.rowsDone}/{a.rows} riviä · {a.done}/{a.total} paalua {complete ? '✅' : ''}
                </span>
              </div>
            )
          })
        }
      </div>
    )
  }

  // --- Rivilistanäkymä (valitun alueen sisällä) ---
  const areaRows = (rowSummary || []).filter(r => r.area === selectedArea)
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'sans-serif' }}>
      <button onClick={closeArea} style={{ marginBottom: 12, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, background: '#fff' }}>
        ← Takaisin alueisiin
      </button>
      <h2 style={{ marginTop: 0 }}>{selectedArea}</h2>

      {areaRows.map(r => (
        <div key={r.row_number} onClick={() => openRow(r.row_number)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 14, marginBottom: 6, borderRadius: 8, cursor: 'pointer',
            background: r.row_complete ? '#e8f5e9' : '#f7f7f7', border: '1px solid #e0e0e0'
          }}>
          <b>Rivi {r.row_number}</b>
          <span style={{ color: r.row_complete ? '#1a7a45' : '#666' }}>
            {r.done_piles} / {r.total_piles} {r.row_complete ? '✅' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
