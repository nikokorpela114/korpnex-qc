// src/PileImport.jsx
// Kertaluontoinen (mutta uudelleenajettava) tuontisivu paalukartta-DXF:lle.
// Avataan osoitteella ?paalutuonti — ei linkitetty mistään näkyvästä
// valikosta, samaan tapaan kuin ?valvomo. Admin-työkalu, siksi
// allowedRoles=['admin'].
import React, { useState, useEffect } from 'react'
import { sb } from './supabaseClient.js'
import { parsePileCSV } from './dxfParser.js'
import AuthGate from './AuthGate.jsx'

const BATCH_SIZE = 500

export default function PileImport() {
  return (
    <AuthGate allowedRoles={['admin']} title="Paalutuonti">
      {({ profile, logout }) => <PileImportApp profile={profile} logout={logout} />}
    </AuthGate>
  )
}

function PileImportApp({ profile, logout }) {
  const companyId = profile.company_id
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [done, setDone] = useState(false)

  // Yrityksen työmaat DB:stä (korvaa vanhan kovakoodatun KNOWN_SITES-listan).
  useEffect(() => {
    sb.from('sites').select('*').order('label').then(({ data }) => {
      setSites(data || [])
      if ((data || []).length && !siteId) setSiteId(data[0].id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function addLog(msg) {
    setLog(prev => [...prev, msg])
  }

  async function runImport() {
    if (!siteId) { addLog('❌ Valitse ensin työmaa (luo yksi Valvomon Työmaat-välilehdellä, jos listalla ei ole yhtään).'); return }
    const siteLabel = sites.find(s => s.id === siteId)?.label || siteId
    setBusy(true)
    setDone(false)
    setLog([])
    try {
      // HUOM: paalukartta ladataan kevyenä CSV:nä ("{company_id}/{site_id}_piles.csv"),
      // EI raakana DXF:nä. CSV sisältää jo OIKEAT työmaan rivinumerot ja
      // aluejaon (pole_id,area,row_number,x,y), poimittu paikallisesti
      // kahdeksasta aluekohtaisesta paalutuskartta-DXF:stä — ei enää tarvetta
      // arvata/klusteroida rivejä sovelluksessa. Tallennuspolku on yrityksen
      // ja työmaan id:n mukaan, sama käytäntö kuin DXF-kartoilla.
      const storagePath = `${companyId}/${siteId}_piles.csv`
      addLog(`Ladataan ${storagePath} Supabase Storagesta...`)
      const { data, error } = await sb.storage.from('maps').download(storagePath)
      if (error || !data) {
        addLog('❌ CSV:tä ei löytynyt bucketista "maps". Tarkista tiedostonimi/polku.')
        setBusy(false)
        return
      }
      const text = await data.text()

      addLog('Parsitaan paalupisteet...')
      const rows = parsePileCSV(text)
      addLog(`Löytyi ${rows.length} paalupistettä.`)
      if (rows.length === 0) {
        addLog('❌ CSV ei sisältänyt yhtään paalupistettä — tarkista tiedoston sisältö.')
        setBusy(false)
        return
      }
      const areaCount = new Set(rows.map(r => r.area)).size
      const rowCount = new Set(rows.map(r => `${r.area}__${r.rowNumber}`)).size
      addLog(`${areaCount} aluetta, ${rowCount} aluekohtaista riviä.`)

      addLog(`Tallennetaan Supabaseen (${BATCH_SIZE} kerrallaan, upsert pole_id:n mukaan)...`)
      let saved = 0
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE).map(r => ({
          site: siteId,
          company_id: companyId,
          pole_id: r.poleId,
          area: r.area,
          row_group_id: `${r.area}_${r.rowNumber}`,
          row_number: r.rowNumber,
          x: r.x,
          y: r.y
        }))
        const { error: upErr } = await sb.from('piles').upsert(batch, { onConflict: 'pole_id' })
        if (upErr) {
          addLog(`❌ Virhe erässä ${i}-${i + batch.length}: ${upErr.message}`)
          setBusy(false)
          return
        }
        saved += batch.length
        addLog(`  ...${saved} / ${rows.length} tallennettu`)
      }

      addLog(`✅ Valmis! ${saved} paalua, ${areaCount} aluetta, ${rowCount} riviä tuotu työmaalle "${siteLabel}".`)
      setDone(true)
    } catch (e) {
      addLog(`❌ Odottamaton virhe: ${e.message}`)
    }
    setBusy(false)
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 20, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Paalujen tuonti DXF:stä</h2>
        <button onClick={logout} style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', fontSize: 13 }}>
          Kirjaudu ulos
        </button>
      </div>
      <p style={{ color: '#666', fontSize: 14 }}>
        Lukee valitun työmaan paalu-CSV:n Storagesta (bucket "maps") — CSV
        sisältää jo valmiin alue- ja rivijaon — ja tallentaa/päivittää ne
        piles-tauluun. Tämän voi ajaa uudelleen turvallisesti (upsert
        pole_id:n mukaan, ei tee tuplia).
      </p>

      <label style={{ display: 'block', marginBottom: 6, fontWeight: 'bold' }}>Työmaa</label>
      <select
        value={siteId}
        onChange={e => setSiteId(e.target.value)}
        disabled={busy}
        style={{ width: '100%', padding: 8, marginBottom: 16, fontSize: 16 }}
      >
        {sites.length === 0 && <option value="">Ei työmaita — luo yksi Valvomon Työmaat-välilehdellä</option>}
        {sites.map(s => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>

      <button
        onClick={runImport}
        disabled={busy || !siteId}
        style={{
          width: '100%', padding: 12, fontSize: 16, fontWeight: 'bold',
          background: busy ? '#ccc' : '#1a7a45', color: 'white', border: 'none', borderRadius: 6
        }}
      >
        {busy ? 'Tuodaan...' : done ? '✅ Tuo uudelleen' : 'Tuo paalut'}
      </button>

      <div style={{
        marginTop: 16, background: '#f4f4f4', borderRadius: 6, padding: 12,
        fontSize: 13, fontFamily: 'monospace', maxHeight: 400, overflowY: 'auto', whiteSpace: 'pre-wrap'
      }}>
        {log.length === 0 ? 'Loki näkyy tässä...' : log.join('\n')}
      </div>
    </div>
  )
}
