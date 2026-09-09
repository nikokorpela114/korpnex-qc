// src/Dashboard.jsx
// Työnjohtajan "valvomo" — työpöytäkäyttöön tarkoitettu yleiskatsaus siitä
// kuka (henkilö tai tiimi) on korjaamassa mitä, mikä on auki, mikä korjattu.
// Avataan osoitteesta /?valvomo (sama reititysperiaate kuin /?asentaja).
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { sb } from './supabaseClient.js'
import AuthGate, { describeFnError } from './AuthGate.jsx'
import { typeLabel, extraLabel, PILE_TYPES, EXTRA_ACTIONS, buildRowExportFiles, orderPilesAlongRow } from './PaalutusView.jsx'

const sevColor = { Kriittinen: '#b02828', Huomio: '#a06800', Info: '#1a7a45' }
const sevBg = { Kriittinen: '#fde2e2', Huomio: '#fdf0d5', Info: '#dcefe3' }
const REFRESH_MS = 30000
const ROLE_LABEL = { admin: 'Ylläpitäjä', asentaja: 'Asentaja', paaluttaja: 'Paaluttaja' }

// Valvomon kirjautuminen hoidetaan jaetulla AuthGate-komponentilla
// (src/AuthGate.jsx) — sama komponentti hoitaa myös asentaja/paalutus-
// näkymien kirjautumisen. allowedRoles=['admin'] tarkoittaa että vain
// pääkäyttäjä-roolin tilit pääsevät Valvomoon; muun roolin tilit näkevät
// AuthGaten "väärä rooli" -ilmoituksen.
export default function Dashboard() {
  return (
    <AuthGate allowedRoles={['admin']} title="Valvomo">
      {({ session, profile, logout }) => <DashboardInner session={session} profile={profile} logout={logout} />}
    </AuthGate>
  )
}

function DashboardInner({ session, profile, logout }) {
  const companyId = profile.company_id
  const [company, setCompany] = useState(null)
  const [editingCompanyName, setEditingCompanyName] = useState(false)
  const [companyNameInput, setCompanyNameInput] = useState('')
  const [sites, setSites] = useState([])
  const [newSiteLabel, setNewSiteLabel] = useState('')
  const [obs, setObs] = useState([])
  const [installers, setInstallers] = useState([])
  const [teams, setTeams] = useState([])
  const [contractors, setContractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [siteFilter, setSiteFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('open') // 'open' | 'fixed' | 'hidden' | 'nearmiss' | 'teams' | 'contractors' | 'piling'
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [lightboxSrc, setLightboxSrc] = useState(null) // korjauskuvan suurennettu näkymä

  // --- Urakoitsijat-välilehden tila ---
  const [newContractorName, setNewContractorName] = useState('')
  const [selectedContractorId, setSelectedContractorId] = useState('')

  // --- Käyttäjät-välilehden tila (yrityksen omat sähköposti+salasana-tunnukset) ---
  const [companyUsers, setCompanyUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userErr, setUserErr] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('asentaja')

  // --- Paalutus-välilehden tila ---
  const [pileOperators, setPileOperators] = useState([])
  const [pileRowSummary, setPileRowSummary] = useState([])
  const [pileSiteFilter, setPileSiteFilter] = useState('')
  const [expandedRowKey, setExpandedRowKey] = useState(null)
  const [expandedRowPiles, setExpandedRowPiles] = useState(null)
  const [editPileId, setEditPileId] = useState(null)
  const [editPileType, setEditPileType] = useState('')
  const [editPileExtra, setEditPileExtra] = useState('')
  const [editPileKn, setEditPileKn] = useState('')

  const load = useCallback(async () => {
    const [
      { data: o, error: oErr }, { data: i, error: iErr }, { data: tm, error: tErr },
      { data: po, error: poErr }, { data: prs, error: prsErr }, { data: co, error: cErr },
      { data: st, error: stErr }, { data: cmp, error: cmpErr },
    ] = await Promise.all([
      sb.from('observations').select('*').order('created_at', { ascending: false }).limit(3000),
      sb.from('installers').select('*').order('name'),
      sb.from('teams').select('*').order('name'),
      sb.from('pile_operators').select('*').order('name'),
      sb.from('pile_rows_summary').select('*').order('area').order('row_number'),
      sb.from('contractors').select('*').order('name'),
      sb.from('sites').select('*').order('label'),
      sb.from('companies').select('*').eq('id', companyId).maybeSingle(),
    ])
    if (oErr) console.error('Dashboard: observations fetch failed', oErr)
    if (iErr) console.error('Dashboard: installers fetch failed', iErr)
    if (tErr) console.error('Dashboard: teams fetch failed', tErr)
    if (poErr) console.error('Dashboard: pile_operators fetch failed', poErr)
    if (prsErr) console.error('Dashboard: pile_rows_summary fetch failed', prsErr)
    if (cErr) console.error('Dashboard: contractors fetch failed', cErr)
    if (stErr) console.error('Dashboard: sites fetch failed', stErr)
    if (cmpErr) console.error('Dashboard: company fetch failed', cmpErr)
    setObs(o || [])
    setInstallers(i || [])
    setTeams(tm || [])
    setPileOperators(po || [])
    setPileRowSummary(prs || [])
    setContractors(co || [])
    setSites(st || [])
    setCompany(cmp || null)
    setPileSiteFilter(prev => prev || st?.[0]?.id || '')
    setLoading(false)
    setLastRefresh(new Date())
  }, [companyId])

  useEffect(() => {
    load()
    const iv = setInterval(load, REFRESH_MS)
    return () => clearInterval(iv)
  }, [load])

  const installerById = useMemo(() => {
    const m = new Map(); installers.forEach(i => m.set(i.id, i)); return m
  }, [installers])
  const teamById = useMemo(() => {
    const m = new Map(); teams.forEach(t => m.set(t.id, t)); return m
  }, [teams])
  const contractorById = useMemo(() => {
    const m = new Map(); contractors.forEach(c => m.set(c.id, c)); return m
  }, [contractors])

  // Ryhmittelyavain jokaiselle havainnolle: tiimi (jos asentaja kuuluu
  // tiimiin, tai havainto on osoitettu suoraan tiimille), muuten
  // yksittäinen asentaja, muuten "ei lähetetty kenellekään".
  const groupInfo = useCallback(o => {
    if (o.assigned_team_id) return { key: 'team:' + o.assigned_team_id, team: teamById.get(o.assigned_team_id), installer: null }
    if (o.assigned_installer_id) {
      const inst = installerById.get(o.assigned_installer_id)
      if (inst?.team_id) return { key: 'team:' + inst.team_id, team: teamById.get(inst.team_id), installer: inst }
      return { key: 'inst:' + o.assigned_installer_id, team: null, installer: inst }
    }
    return { key: '__unassigned', team: null, installer: null }
  }, [installerById, teamById])

  // Urakoitsija-taso: tiimi tai asentaja "kuuluu" urakoitsijaan (contractor_id),
  // ja havainto perii sen sen mukaan kenelle se on osoitettu. Jos havainto on
  // osoitettu tiimille, tiimin oma urakoitsija ratkaisee; jos yksittäiselle
  // asentajalle, käytetään ensin hänen tiiminsä urakoitsijaa (jos tiimillä on
  // sellainen), sitten asentajan omaa urakoitsijaa.
  const contractorIdOf = useCallback(o => {
    if (o.assigned_team_id) return teamById.get(o.assigned_team_id)?.contractor_id || null
    if (o.assigned_installer_id) {
      const inst = installerById.get(o.assigned_installer_id)
      if (!inst) return null
      if (inst.team_id) {
        const teamContractor = teamById.get(inst.team_id)?.contractor_id
        if (teamContractor) return teamContractor
      }
      return inst.contractor_id || null
    }
    return null
  }, [installerById, teamById])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return obs.filter(o => {
      if (siteFilter && o.site !== siteFilter) return false
      if (teamFilter) {
        const g = groupInfo(o)
        if (g.key !== 'team:' + teamFilter) return false
      }
      if (q) {
        const hay = `${o.cat || ''} ${o.note || ''} ${o.rivi || ''} ${o.inspector || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [obs, siteFilter, teamFilter, search, groupInfo])

  // Läheltäpiti-ilmoituksilla (type = 'laheltapiti') ei ole korjausseurantaa,
  // niin ne pidetään erillään "Avoimet"/"Korjatut"-vikalistoista omassa
  // välilehdessään — vanhat rivit (type = null) tulkitaan aina "vika":ksi.
  const openObs = useMemo(() => filtered.filter(o => o.status !== 'korjattu' && !o.hidden_at && (o.type || 'vika') !== 'laheltapiti'), [filtered])
  const fixedObs = useMemo(() => filtered.filter(o => o.status === 'korjattu' && !o.hidden_at && (o.type || 'vika') !== 'laheltapiti'), [filtered])
  const hiddenObs = useMemo(() => filtered.filter(o => !!o.hidden_at), [filtered])
  const nearMissObs = useMemo(() => filtered.filter(o => (o.type || 'vika') === 'laheltapiti' && !o.hidden_at), [filtered])
  const nearMissSorted = useMemo(
    () => [...nearMissObs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
    [nearMissObs]
  )
  const totalCritical = useMemo(() => openObs.filter(o => o.sev === 'Kriittinen').length, [openObs])

  const openByGroup = useMemo(() => {
    const groups = new Map()
    openObs.forEach(o => {
      const g = groupInfo(o)
      if (!groups.has(g.key)) groups.set(g.key, { ...g, items: [] })
      groups.get(g.key).items.push(o)
    })
    return groups
  }, [openObs, groupInfo])

  const fixedSorted = useMemo(
    () => [...fixedObs].sort((a, b) => new Date(b.fixed_at || 0) - new Date(a.fixed_at || 0)),
    [fixedObs]
  )
  const hiddenSorted = useMemo(
    () => [...hiddenObs].sort((a, b) => new Date(b.hidden_at || 0) - new Date(a.hidden_at || 0)),
    [hiddenObs]
  )

  const fmtTime = iso => iso
    ? new Date(iso).toLocaleString('fi-FI', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const clearSelection = () => setSelected(new Set())

  const toggleSelectGroup = items => setSelected(prev => {
    const ids = items.map(o => o.id)
    const allSelected = ids.every(id => prev.has(id))
    const next = new Set(prev)
    ids.forEach(id => allSelected ? next.delete(id) : next.add(id))
    return next
  })

  async function hideSelected() {
    if (selected.size === 0) return
    setBusy(true)
    const { data, error } = await sb.from('observations').update({ hidden_at: new Date().toISOString() }).in('id', [...selected]).select()
    if (error) { console.error(error); alert('Piilotus epäonnistui: ' + error.message) }
    else if (!data || data.length === 0) alert('Piilotus ei muuttanut mitään — aja teams_rls_fix.sql Supabasen SQL Editorissa.')
    clearSelection(); setBusy(false); load()
  }
  async function unhideSelected() {
    if (selected.size === 0) return
    setBusy(true)
    const { data, error } = await sb.from('observations').update({ hidden_at: null }).in('id', [...selected]).select()
    if (error) { console.error(error); alert('Palautus epäonnistui: ' + error.message) }
    else if (!data || data.length === 0) alert('Palautus ei muuttanut mitään — aja teams_rls_fix.sql Supabasen SQL Editorissa.')
    clearSelection(); setBusy(false); load()
  }
  async function deleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`Poistetaanko ${selected.size} havaintoa pysyvästi? Tätä ei voi perua.`)) return
    setBusy(true)
    const { error } = await sb.from('observations').delete().in('id', [...selected])
    if (error) { console.error(error); alert('Poisto epäonnistui: ' + error.message + '\n\nJos virhe mainitsee "permission denied", teams_schema.sql:n DELETE-oikeutta ei ole ajettu Supabaseen.') }
    clearSelection(); setBusy(false); load()
  }

  async function createTeam() {
    const name = newTeamName.trim()
    if (!name) return
    const { error } = await sb.from('teams').insert([{ name, company_id: companyId }])
    if (error) { alert('Tiimin luonti epäonnistui: ' + error.message); return }
    setNewTeamName('')
    load()
  }
  async function deleteTeam(id) {
    if (!window.confirm('Poistetaanko tiimi? Jäsenet jäävät ilman tiimiä, eivät poistu.')) return
    const { error } = await sb.from('teams').delete().eq('id', id)
    if (error) { alert('Poisto epäonnistui: ' + error.message); return }
    load()
  }

  // --- Yrityksen nimi ---
  async function saveCompanyName() {
    const name = companyNameInput.trim()
    if (!name) return
    const { data, error } = await sb.from('companies').update({ name }).eq('id', companyId).select().maybeSingle()
    if (error) { alert('Tallennus epäonnistui: ' + error.message); return }
    setCompany(data)
    setEditingCompanyName(false)
  }

  // --- Työmaat ---
  async function createSite() {
    const label = newSiteLabel.trim()
    if (!label) return
    const { error } = await sb.from('sites').insert([{ label, company_id: companyId }])
    if (error) { alert('Työmaan luonti epäonnistui: ' + error.message); return }
    setNewSiteLabel('')
    load()
  }
  async function deleteSite(id) {
    if (!window.confirm('Poistetaanko työmaa? Sen kartta/DXF ja paalutiedot eivät poistu automaattisesti.')) return
    const { error } = await sb.from('sites').delete().eq('id', id)
    if (error) { alert('Poisto epäonnistui: ' + error.message); return }
    load()
  }

  // --- Urakoitsijat ---
  async function createContractor() {
    const name = newContractorName.trim()
    if (!name) return
    const { error } = await sb.from('contractors').insert([{ name, company_id: companyId }])
    if (error) { alert('Urakoitsijan luonti epäonnistui: ' + error.message + '\n\nJos virhe mainitsee taulun puuttumisen, aja contractors_schema.sql Supabasen SQL Editorissa.'); return }
    setNewContractorName('')
    load()
  }
  async function deleteContractor(id) {
    if (!window.confirm('Poistetaanko urakoitsija? Sille liitetyt tiimit/asentajat jäävät ilman urakoitsijaa, eivät poistu.')) return
    if (selectedContractorId === id) setSelectedContractorId('')
    const { error } = await sb.from('contractors').delete().eq('id', id)
    if (error) { alert('Poisto epäonnistui: ' + error.message); return }
    load()
  }
  async function setInstallerContractor(installerId, contractorId) {
    const { data, error } = await sb.from('installers').update({ contractor_id: contractorId || null }).eq('id', installerId).select()
    if (error) { alert('Tallennus epäonnistui: ' + error.message); return }
    if (!data || data.length === 0) { alert('Tallennus ei muuttanut mitään — tarkista RLS-oikeudet.'); return }
    load()
  }
  async function setTeamContractor(teamId, contractorId) {
    const { data, error } = await sb.from('teams').update({ contractor_id: contractorId || null }).eq('id', teamId).select()
    if (error) { alert('Tallennus epäonnistui: ' + error.message); return }
    if (!data || data.length === 0) { alert('Tallennus ei muuttanut mitään — tarkista RLS-oikeudet.'); return }
    load()
  }

  // --- Yrityksen käyttäjät (Supabase Auth) — hoidetaan manage-company-users
  // Edge Functionin kautta, koska käyttäjän luonti/poisto vaatii
  // service_role-oikeudet, joita ei koskaan saa laittaa selaimeen. Funktio
  // tarkistaa itse että kutsuja on oman yrityksen admin, ja rajaa kaikki
  // toiminnot AINA kutsujan omaan yritykseen — muiden yritysten käyttäjiä
  // ei näy eikä voi hallita täältä.
  async function loadUsers() {
    setUsersLoading(true); setUserErr('')
    const { data, error } = await sb.functions.invoke('manage-company-users', { body: { action: 'list' } })
    setUsersLoading(false)
    if (error || data?.error) { setUserErr(await describeFnError(error, data)); return }
    setCompanyUsers(data.users || [])
  }
  async function createUser() {
    const emailVal = newUserEmail.trim(), pwVal = newUserPassword
    if (!emailVal || pwVal.length < 6) { setUserErr('Anna sähköposti ja vähintään 6 merkin salasana.'); return }
    setUserErr('')
    const { data, error } = await sb.functions.invoke('manage-company-users', { body: { action: 'create', email: emailVal, password: pwVal, role: newUserRole } })
    if (error || data?.error) { setUserErr(await describeFnError(error, data)); return }
    setNewUserEmail(''); setNewUserPassword('')
    loadUsers()
  }
  async function deleteUser(u) {
    if (!window.confirm(`Poistetaanko käyttäjä ${u.email}? Hän ei pääse enää kirjautumaan.`)) return
    setUserErr('')
    const { data, error } = await sb.functions.invoke('manage-company-users', { body: { action: 'delete', user_id: u.id } })
    if (error || data?.error) { setUserErr(await describeFnError(error, data)); return }
    loadUsers()
  }

  async function setInstallerTeam(installerId, teamId) {
    const { data, error } = await sb.from('installers').update({ team_id: teamId || null }).eq('id', installerId).select()
    if (error) { alert('Tallennus epäonnistui: ' + error.message); return }
    if (!data || data.length === 0) {
      alert('Tallennus ei muuttanut mitään — todennäköisesti Row Level Security estää päivityksen. Aja teams_rls_fix.sql Supabasen SQL Editorissa.')
      return
    }
    load()
  }

  async function deleteInstaller(installer) {
    const assignedCount = obs.filter(o => o.assigned_installer_id === installer.id).length
    const warn = assignedCount > 0
      ? `${installer.name} on merkitty ${assignedCount} havainnon korjaajaksi/vastaanottajaksi. Nämä havainnot säilyvät, mutta "korjaaja"-tieto niissä tyhjenee. Poistetaanko silti?`
      : `Poistetaanko asentaja ${installer.name}?`
    if (!window.confirm(warn)) return
    const { error } = await sb.from('installers').delete().eq('id', installer.id)
    if (error) {
      alert('Poisto epäonnistui: ' + error.message + '\n\nJos virhe mainitsee viiteavaimen (foreign key), aja installer_delete_fix.sql Supabasen SQL Editorissa.')
      return
    }
    load()
  }

  // --- Paalutus: paaluttajien hallinta (uudet tilit luodaan Käyttäjät-
  // välilehdellä roolilla "Paaluttaja" — he ilmestyvät tähän listaan
  // automaattisesti ensimmäisen kirjautumisen jälkeen) ---
  async function deletePileOperator(op) {
    if (!window.confirm(`Poistetaanko paaluttaja ${op.name}?`)) return
    const { error } = await sb.from('pile_operators').delete().eq('id', op.id)
    if (error) { alert('Poisto epäonnistui: ' + error.message); return }
    load()
  }

  // --- Paalutus: rivin laajennus (näyttää saman sisällön kuin "Rivi valmis" -vienti) ---
  async function toggleRowExpand(area, rowNumber) {
    const key = `${area}__${rowNumber}`
    if (expandedRowKey === key) { setExpandedRowKey(null); setExpandedRowPiles(null); return }
    setExpandedRowKey(key)
    setExpandedRowPiles(null)
    setEditPileId(null)
    const site = pileSiteFilter || sites[0]?.id
    const { data, error } = await sb.from('piles').select('*').eq('site', site).eq('area', area).eq('row_number', rowNumber).order('id')
    // Sama fyysinen pääsuunta-lajittelu kuin paaluttajan näkymässä (PaalutusView),
    // jotta valvomon numerointi ja vienti täsmäävät paaluttajan omaan näkymään.
    setExpandedRowPiles(error ? [] : orderPilesAlongRow(data || []))
  }

  // Tyhjentää KOKO avoinna olevan rivin — kaikki sen paalut palautuvat
  // merkitsemättömiksi (esim. jos paaluttaja teki virheen koko rivillä).
  async function resetWholeRow(area, rowNumber) {
    if (!window.confirm(`Tyhjennetäänkö KOKO rivi ${rowNumber} (${area})? Kaikki sen paalujen merkinnät poistuvat.`)) return
    const site = pileSiteFilter || sites[0]?.id
    const { error } = await sb.from('piles').update({
      pile_type: null, extra_action: null, pull_test_kn: null,
      status: 'open', installed_by: null, installed_at: null
    }).eq('site', site).eq('area', area).eq('row_number', rowNumber)
    if (error) { alert('Tyhjennys epäonnistui: ' + error.message); return }
    const { data: refreshed } = await sb.from('piles').select('*').eq('site', site).eq('area', area).eq('row_number', rowNumber).order('id')
    setExpandedRowPiles(orderPilesAlongRow(refreshed || []))
    load()
  }

  // Yksittäisen paalun tyhjennys (palauttaa merkitsemättömäksi)
  async function resetPile(pileId) {
    if (!window.confirm('Tyhjennetäänkö tämän paalun merkintä?')) return
    const { data, error } = await sb.from('piles').update({
      pile_type: null, extra_action: null, pull_test_kn: null,
      status: 'open', installed_by: null, installed_at: null
    }).eq('id', pileId).select().single()
    if (error) { alert('Tyhjennys epäonnistui: ' + error.message); return }
    setExpandedRowPiles(prev => prev.map(p => p.id === pileId ? data : p))
  }

  // Yksittäisen paalun muokkaus (koko, lisätoimenpide, vetotesti)
  function startEditPile(pile) {
    setEditPileId(pile.id)
    setEditPileType(pile.pile_type || '')
    setEditPileExtra(pile.extra_action || '')
    setEditPileKn(pile.pull_test_kn ?? '')
  }
  async function saveEditPile(pileId) {
    const { data, error } = await sb.from('piles').update({
      pile_type: editPileType || null,
      extra_action: editPileExtra || null,
      pull_test_kn: editPileKn === '' ? null : parseFloat(editPileKn),
      status: (editPileType || editPileExtra) ? 'done' : 'open',
    }).eq('id', pileId).select().single()
    if (error) { alert('Tallennus epäonnistui: ' + error.message); return }
    setExpandedRowPiles(prev => prev.map(p => p.id === pileId ? data : p))
    setEditPileId(null)
  }

  // Lataa rivin PDF + Excel suoraan tiedostoina (työpöytäkäyttö — ei
  // jakovalikkoa, samat tiedostot kuin paaluttajan puhelimessa)
  async function downloadRowFiles(area, rowNumber) {
    if (!expandedRowPiles || expandedRowPiles.length === 0) return
    const siteLabel = sites.find(s => s.id === (pileSiteFilter || sites[0]?.id))?.label || pileSiteFilter
    const { pdfBlob, xlsxBlob, baseName } = await buildRowExportFiles(expandedRowPiles, area, rowNumber, siteLabel)
    for (const [blob, name] of [[pdfBlob, `${baseName}.pdf`], [xlsxBlob, `${baseName}.xlsx`]]) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    }
  }


  return (
    <div style={{ minHeight: '100vh', background: '#f6f7fb', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ background: '#070b17', padding: '20px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/korpnex-icon.png" alt="Korpnex" style={{ height: 32, width: 'auto', display: 'block' }} />
          <div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 19, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>KORPNEX</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500, marginLeft: 4 }}>· Valvomo</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: 13, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
            {editingCompanyName ? (
              <>
                <input
                  value={companyNameInput} onChange={e => setCompanyNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCompanyName()}
                  autoFocus
                  style={{ padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 13 }}
                />
                <button onClick={saveCompanyName} style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>✓</button>
                <button onClick={() => setEditingCompanyName(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 12, cursor: 'pointer' }}>✕</button>
              </>
            ) : (
              <>
                🏢 {company?.name || '—'}
                <button
                  onClick={() => { setCompanyNameInput(company?.name || ''); setEditingCompanyName(true) }}
                  title="Muokkaa yrityksen nimeä"
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 12, cursor: 'pointer' }}
                >✏️</button>
              </>
            )}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12.5, marginTop: 3 }}>
            {loading ? 'Ladataan…' : `Päivitetty ${lastRefresh?.toLocaleTimeString('fi-FI')} · päivittyy automaattisesti`}
          </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12.5 }}>{session?.user?.email}</span>
          <button onClick={load} style={{ background: 'rgba(255,255,255,0.16)', border: 'none', color: '#fff', borderRadius: 9, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'background 0.15s' }}>
            🔄 Päivitä nyt
          </button>
          <button onClick={logout} style={{ background: 'rgba(255,255,255,0.16)', border: 'none', color: '#fff', borderRadius: 9, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Kirjaudu ulos
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '26px 30px 70px' }}>
        {/* Yhteenveto */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 26, flexWrap: 'wrap' }}>
          <SummaryCard label="Avoimia" value={openObs.length} color="#1560c4" />
          <SummaryCard label="Joista kriittisiä" value={totalCritical} color="#b02828" />
          <SummaryCard label="Korjattu" value={fixedObs.length} color="#1a8a50" />
          <SummaryCard label="Asentajia" value={installers.length} color="#6670a0" />
          <SummaryCard label="Tiimejä" value={teams.length} color="#8a5fc9" />
          <SummaryCard label="Läheltäpiti" value={nearMissObs.length} color="#a06800" />
          <SummaryCard label="Urakoitsijoita" value={contractors.length} color="#1560c4" />
          <SummaryCard label="Työmaita" value={sites.length} color="#0e8fe0" />
        </div>

        {/* Suodattimet */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} style={selectStyle}>
            <option value="">Kaikki työmaat</option>
            {sites.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
          </select>
          <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={selectStyle}>
            <option value="">Kaikki tiimit</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input
            placeholder="Hae (vikatyyppi, rivi, tarkastaja)…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...selectStyle, flex: 1, minWidth: 220 }}
          />
          <div style={{ display: 'flex', gap: 3, background: '#e9ebf6', padding: 4, borderRadius: 10, flexWrap: 'wrap' }}>
            <TabButton active={tab === 'open'} onClick={() => { setTab('open'); clearSelection() }}>Avoimet ({openObs.length})</TabButton>
            <TabButton active={tab === 'fixed'} onClick={() => { setTab('fixed'); clearSelection() }}>Korjatut ({fixedObs.length})</TabButton>
            <TabButton active={tab === 'nearmiss'} onClick={() => { setTab('nearmiss'); clearSelection() }}>Läheltäpiti ({nearMissObs.length})</TabButton>
            <TabButton active={tab === 'hidden'} onClick={() => { setTab('hidden'); clearSelection() }}>Piilotetut ({hiddenObs.length})</TabButton>
            <TabButton active={tab === 'teams'} onClick={() => { setTab('teams'); clearSelection() }}>Tiimit</TabButton>
            <TabButton active={tab === 'contractors'} onClick={() => { setTab('contractors'); clearSelection() }}>Urakoitsijat</TabButton>
            <TabButton active={tab === 'sites'} onClick={() => { setTab('sites'); clearSelection() }}>Työmaat</TabButton>
            <TabButton active={tab === 'users'} onClick={() => { setTab('users'); clearSelection(); loadUsers() }}>Käyttäjät</TabButton>
            <TabButton active={tab === 'piling'} onClick={() => { setTab('piling'); clearSelection() }}>Paalutus</TabButton>
          </div>
        </div>

        {/* Massatoimintopalkki */}
        {selected.size > 0 && tab !== 'teams' && tab !== 'piling' && tab !== 'contractors' && tab !== 'users' && tab !== 'sites' && (
          <div style={{ position: 'sticky', top: 12, zIndex: 10, background: '#fff', border: '1px solid #d0d5e8', borderRadius: 12, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 16px rgba(20,30,80,0.10)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1a6e' }}>{selected.size} valittu</span>
            <div style={{ flex: 1 }} />
            {tab === 'hidden' ? (
              <ActionBtn onClick={unhideSelected} disabled={busy} color="#1a8a50">↩️ Palauta</ActionBtn>
            ) : (
              <ActionBtn onClick={hideSelected} disabled={busy} color="#a06800">🙈 Piilota</ActionBtn>
            )}
            <ActionBtn onClick={deleteSelected} disabled={busy} color="#b02828">🗑️ Poista pysyvästi</ActionBtn>
            <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#9aa2c0', fontSize: 13, cursor: 'pointer', padding: '6px 8px' }}>Peruuta</button>
          </div>
        )}

        {tab === 'open' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
            {[...openByGroup.values()]
              .sort((a, b) => b.items.length - a.items.length)
              .map(g => {
                const critCount = g.items.filter(o => o.sev === 'Kriittinen').length
                const title = g.team ? `🧑‍🤝‍🧑 ${g.team.name}` : g.installer ? `👷 ${g.installer.name}` : '📋 Ei lähetetty kenellekään'
                const headerBg = g.team ? '#f1ecfb' : g.installer ? '#eef0f7' : '#fdf0d5'
                const allSelected = g.items.length > 0 && g.items.every(o => selected.has(o.id))
                return (
                  <div key={g.key} style={cardStyle}>
                    <div style={{ padding: '13px 16px', background: headerBg, borderBottom: '1px solid #e4e7f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e' }}>{title}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: critCount > 0 ? '#b02828' : '#6670a0' }}>
                        {g.items.length} kpl{critCount > 0 ? ` · ${critCount} kriitt.` : ''}
                      </span>
                    </div>
                    {g.team && g.team.name && (
                      <div style={{ padding: '6px 16px', fontSize: 11, color: '#8a5fc9', background: '#faf8ff', borderBottom: '1px solid #f0f1f7' }}>
                        {installers.filter(i => i.team_id === g.team.id).map(i => i.name).join(', ') || 'Ei jäseniä'}
                      </div>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', fontSize: 12, color: '#6670a0', borderBottom: '1px solid #f0f1f7', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={allSelected} onChange={() => toggleSelectGroup(g.items)} />
                      {allSelected ? 'Poista kaikki valinnat' : 'Valitse kaikki'}
                    </label>
                    <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                      {g.items.map(o => (
                        <ObsRow key={o.id} o={o} fmtTime={fmtTime} selected={selected.has(o.id)} onToggle={() => toggleSelect(o.id)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            {openByGroup.size === 0 && <EmptyState text="Ei avoimia vikoja 🎉" />}
          </div>
        )}

        {tab === 'fixed' && (
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#eef0f7', textAlign: 'left' }}>
                  <th style={{ ...thStyle, width: 34 }}>
                    <input type="checkbox" checked={fixedSorted.length > 0 && fixedSorted.every(o => selected.has(o.id))} onChange={() => toggleSelectGroup(fixedSorted)} />
                  </th>
                  <th style={thStyle}>Vika</th>
                  <th style={thStyle}>Vakavuus</th>
                  <th style={thStyle}>Työmaa / rivi</th>
                  <th style={thStyle}>Korjaaja</th>
                  <th style={thStyle}>Havaittu</th>
                  <th style={thStyle}>Korjattu</th>
                  <th style={thStyle}>Kuva</th>
                </tr>
              </thead>
              <tbody>
                {fixedSorted.map(o => (
                  <TableRow key={o.id} o={o} installerById={installerById} fmtTime={fmtTime} selected={selected.has(o.id)} onToggle={() => toggleSelect(o.id)} onOpenPhoto={setLightboxSrc} />
                ))}
                {fixedSorted.length === 0 && (
                  <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#9aa2c0', padding: 40 }}>Ei vielä korjattuja</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'hidden' && (
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#eef0f7', textAlign: 'left' }}>
                  <th style={{ ...thStyle, width: 34 }}>
                    <input type="checkbox" checked={hiddenSorted.length > 0 && hiddenSorted.every(o => selected.has(o.id))} onChange={() => toggleSelectGroup(hiddenSorted)} />
                  </th>
                  <th style={thStyle}>Vika</th>
                  <th style={thStyle}>Vakavuus</th>
                  <th style={thStyle}>Työmaa / rivi</th>
                  <th style={thStyle}>Tila</th>
                  <th style={thStyle}>Piilotettu</th>
                </tr>
              </thead>
              <tbody>
                {hiddenSorted.map(o => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #f0f1f7' }}>
                    <td style={tdStyle}><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} /></td>
                    <td style={tdStyle}>{o.cat}</td>
                    <td style={tdStyle}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: sevBg[o.sev], color: sevColor[o.sev] }}>{o.sev}</span></td>
                    <td style={tdStyle}>{o.site}{o.rivi ? ` · ${o.rivi}` : ''}</td>
                    <td style={tdStyle}>{o.status === 'korjattu' ? 'Korjattu' : 'Avoin'}</td>
                    <td style={tdStyle}>{fmtTime(o.hidden_at)}</td>
                  </tr>
                ))}
                {hiddenSorted.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#9aa2c0', padding: 40 }}>Ei piilotettuja</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'nearmiss' && (
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#eef0f7', textAlign: 'left' }}>
                  <th style={{ ...thStyle, width: 34 }}>
                    <input type="checkbox" checked={nearMissSorted.length > 0 && nearMissSorted.every(o => selected.has(o.id))} onChange={() => toggleSelectGroup(nearMissSorted)} />
                  </th>
                  <th style={thStyle}>Kuvaus</th>
                  <th style={thStyle}>Vakavuus</th>
                  <th style={thStyle}>Työmaa / rivi</th>
                  <th style={thStyle}>Urakoitsija</th>
                  <th style={thStyle}>Ilmoittaja</th>
                  <th style={thStyle}>Aika</th>
                </tr>
              </thead>
              <tbody>
                {nearMissSorted.map(o => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #f0f1f7', background: selected.has(o.id) ? '#f3f5ff' : 'transparent' }}>
                    <td style={tdStyle}><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} /></td>
                    <td style={tdStyle}>{o.note || <span style={{ color: '#c3c8dc' }}>—</span>}</td>
                    <td style={tdStyle}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: sevBg[o.sev], color: sevColor[o.sev] }}>{o.sev}</span></td>
                    <td style={tdStyle}>{o.site}{o.rivi ? ` · ${o.rivi}` : ''}</td>
                    <td style={tdStyle}>{contractorById.get(contractorIdOf(o))?.name || '—'}</td>
                    <td style={tdStyle}>{o.inspector || '—'}</td>
                    <td style={tdStyle}>{fmtTime(o.created_at)}</td>
                  </tr>
                ))}
                {nearMissSorted.length === 0 && (
                  <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#9aa2c0', padding: 40 }}>Ei läheltäpiti-ilmoituksia</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'teams' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            <div style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e', marginBottom: 10 }}>+ Uusi tiimi</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  placeholder="Tiimin nimi (esim. Tiimi 1)"
                  value={newTeamName}
                  onChange={e => setNewTeamName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createTeam()}
                  style={{ ...selectStyle, flex: 1 }}
                />
                <button onClick={createTeam} style={{ background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Luo</button>
              </div>
            </div>

            {teams.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                installers={installers}
                onDeleteTeam={deleteTeam}
                onSetInstallerTeam={setInstallerTeam}
              />
            ))}

            <div style={{ ...cardStyle, padding: 20, gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1a6e', marginBottom: 14 }}>Kaikki asentajat</div>
              {installers.length === 0 && <div style={{ fontSize: 13, color: '#9aa2c0', marginBottom: 10 }}>Ei asentajia vielä</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4px 24px' }}>
                {installers.map(i => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f5fa', gap: 10 }}>
                    <span style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{i.name}</span>
                    <select value={i.team_id || ''} onChange={e => setInstallerTeam(i.id, e.target.value || null)} style={{ ...selectStyle, padding: '6px 10px', fontSize: 12.5 }}>
                    <option value="">Ei tiimiä</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button onClick={() => deleteInstaller(i)} title="Poista asentaja" style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 15, cursor: 'pointer', padding: '2px 4px' }}>🗑️</button>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, color: '#9aa2c0', marginTop: 18, lineHeight: 1.5 }}>
                Uudet asentajat luodaan <b>Käyttäjät</b>-välilehdellä (rooli: Asentaja) — he ilmestyvät tähän listaan automaattisesti heti kun he kirjautuvat ensimmäistä kertaa omalla sähköposti+salasana-tilillään.
              </div>
            </div>
          </div>
        )}

        {tab === 'contractors' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div style={{ ...cardStyle, padding: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e', marginBottom: 10 }}>+ Uusi urakoitsija</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    placeholder="Urakoitsijan nimi"
                    value={newContractorName}
                    onChange={e => setNewContractorName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createContractor()}
                    style={{ ...selectStyle, flex: 1 }}
                  />
                  <button onClick={createContractor} style={{ background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Luo</button>
                </div>
              </div>

              {contractors.map(c => {
                const openCount = openObs.filter(o => contractorIdOf(o) === c.id).length
                const nearMissCount = nearMissObs.filter(o => contractorIdOf(o) === c.id).length
                const active = selectedContractorId === c.id
                return (
                  <div key={c.id} style={{ ...cardStyle, border: active ? '2px solid #1560c4' : '1px solid transparent' }}>
                    <div style={{ padding: '13px 16px', background: '#eaf3fb', borderBottom: '1px solid #e4e7f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e' }}>🏢 {c.name}</span>
                      <button onClick={() => deleteContractor(c.id)} style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 12, cursor: 'pointer' }}>Poista</button>
                    </div>
                    <div style={{ padding: 14 }}>
                      <div style={{ fontSize: 12, color: '#6670a0', marginBottom: 10 }}>
                        {openCount} avoinna oleva{openCount === 1 ? '' : 'a'} vika · {nearMissCount} läheltäpiti
                      </div>
                      <button
                        onClick={() => setSelectedContractorId(active ? '' : c.id)}
                        style={{
                          width: '100%', padding: 9, borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                          background: active ? '#1560c4' : '#eef0f7', color: active ? '#fff' : '#1560c4',
                        }}
                      >
                        {active ? '✓ Näytetään data alla' : 'Näytä data'}
                      </button>
                    </div>
                  </div>
                )
              })}
              {contractors.length === 0 && (
                <div style={{ ...cardStyle, padding: 18, color: '#9aa2c0', fontSize: 13 }}>Ei urakoitsijoita vielä — luo ensimmäinen yllä.</div>
              )}
            </div>

            {/* Urakoitsijakohtainen data: valitun urakoitsijan avoimet+korjatut viat ja läheltäpiti-ilmoitukset */}
            {selectedContractorId && (() => {
              const c = contractorById.get(selectedContractorId)
              const cOpen = openObs.filter(o => contractorIdOf(o) === selectedContractorId)
              const cFixed = fixedObs.filter(o => contractorIdOf(o) === selectedContractorId)
              const cNearMiss = nearMissSorted.filter(o => contractorIdOf(o) === selectedContractorId)
              return (
                <div style={{ ...cardStyle, padding: 20, marginBottom: 24 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#0d1a6e', marginBottom: 16 }}>🏢 {c?.name} — kaikki data</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1560c4', textTransform: 'uppercase', marginBottom: 8 }}>Avoimet viat ({cOpen.length})</div>
                      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eef0f7', borderRadius: 8 }}>
                        {cOpen.map(o => <ObsRow key={o.id} o={o} fmtTime={fmtTime} selected={false} onToggle={() => {}} />)}
                        {cOpen.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: '#9aa2c0' }}>Ei avoimia vikoja</div>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a8a50', textTransform: 'uppercase', marginBottom: 8 }}>Korjatut viat ({cFixed.length})</div>
                      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eef0f7', borderRadius: 8 }}>
                        {cFixed.map(o => <ObsRow key={o.id} o={o} fmtTime={fmtTime} selected={false} onToggle={() => {}} />)}
                        {cFixed.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: '#9aa2c0' }}>Ei korjattuja vikoja</div>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#a06800', textTransform: 'uppercase', marginBottom: 8 }}>Läheltäpiti ({cNearMiss.length})</div>
                      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eef0f7', borderRadius: 8 }}>
                        {cNearMiss.map(o => <ObsRow key={o.id} o={o} fmtTime={fmtTime} selected={false} onToggle={() => {}} />)}
                        {cNearMiss.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: '#9aa2c0' }}>Ei läheltäpiti-ilmoituksia</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Urakoitsija-liitosten hallinta: kaikki tiimit ja asentajat, valitse urakoitsija kummallekin */}
            <div style={{ ...cardStyle, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1a6e', marginBottom: 14 }}>Tiimien ja asentajien urakoitsijat</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa2c0', marginBottom: 8, textTransform: 'uppercase' }}>Tiimit</div>
              {teams.length === 0 && <div style={{ fontSize: 13, color: '#9aa2c0', marginBottom: 10 }}>Ei tiimejä vielä</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4px 24px', marginBottom: 18 }}>
                {teams.map(t => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f5fa', gap: 10 }}>
                    <span style={{ fontSize: 14, flex: 1, minWidth: 0 }}>🧑‍🤝‍🧑 {t.name}</span>
                    <select value={t.contractor_id || ''} onChange={e => setTeamContractor(t.id, e.target.value || null)} style={{ ...selectStyle, padding: '6px 10px', fontSize: 12.5 }}>
                      <option value="">Ei urakoitsijaa</option>
                      {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa2c0', marginBottom: 8, textTransform: 'uppercase' }}>Asentajat</div>
              {installers.length === 0 && <div style={{ fontSize: 13, color: '#9aa2c0', marginBottom: 10 }}>Ei asentajia vielä</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4px 24px' }}>
                {installers.map(i => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f5fa', gap: 10 }}>
                    <span style={{ fontSize: 14, flex: 1, minWidth: 0 }}>👷 {i.name}{i.team_id ? ` (${teamById.get(i.team_id)?.name || 'tiimi'})` : ''}</span>
                    <select value={i.contractor_id || ''} onChange={e => setInstallerContractor(i.id, e.target.value || null)} style={{ ...selectStyle, padding: '6px 10px', fontSize: 12.5 }}>
                      <option value="">Ei urakoitsijaa</option>
                      {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {teams.some(t => t.contractor_id) && (
                <div style={{ fontSize: 11.5, color: '#9aa2c0', marginTop: 14 }}>
                  Huom: jos asentaja kuuluu tiimiin JA tiimillä on urakoitsija, tiimin urakoitsija ratkaisee sen havainnot — asentajan oma urakoitsija-valinta vaikuttaa vain silloin kun havainto on osoitettu hänelle henkilökohtaisesti eikä hänen tiimilleen.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'sites' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            <div style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e', marginBottom: 10 }}>+ Uusi työmaa</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  placeholder="Työmaan nimi (esim. Aurinkopuisto 3)"
                  value={newSiteLabel}
                  onChange={e => setNewSiteLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createSite()}
                  style={{ ...selectStyle, flex: 1 }}
                />
                <button onClick={createSite} style={{ background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Luo</button>
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 20, gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1a6e', marginBottom: 14 }}>Yrityksen työmaat</div>
              {sites.length === 0 && <div style={{ fontSize: 13, color: '#9aa2c0' }}>Ei työmaita vielä — luo ensimmäinen yllä.</div>}
              {sites.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f5fa', gap: 10 }}>
                  <span style={{ fontSize: 14 }}>📍 {s.label}</span>
                  <button onClick={() => deleteSite(s.id)} title="Poista työmaa" style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 15, cursor: 'pointer', padding: '2px 4px' }}>🗑️</button>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: '#9aa2c0', marginTop: 14 }}>
                Työmaan kartta (DXF) ladataan tarkastajan näkymässä (?tarkastaja) työmaan valinnan yhteydessä.
              </div>
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            <div style={{ ...cardStyle, padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e', marginBottom: 10 }}>+ Uusi käyttäjä</div>
              <div style={{ fontSize: 12, color: '#6670a0', marginBottom: 10 }}>
                Luo tunnus toiselle yrityksesi käyttäjälle (työnjohtaja, asentaja tai paaluttaja) — hän voi kirjautua näillä tiedoilla heti (ei vaadi sähköpostin vahvistusta).
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="email" placeholder="Sähköposti"
                  value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createUser()}
                  style={selectStyle}
                />
                <input
                  type="text" placeholder="Väliaikainen salasana (väh. 6 merkkiä)"
                  value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createUser()}
                  style={selectStyle}
                />
                <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} style={selectStyle}>
                  <option value="asentaja">Asentaja</option>
                  <option value="paaluttaja">Paaluttaja</option>
                  <option value="admin">Ylläpitäjä (Valvomo)</option>
                </select>
                {userErr && <div style={{ color: '#d63030', fontSize: 12.5 }}>{userErr}</div>}
                <button onClick={createUser} style={{ background: '#1560c4', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Luo käyttäjä
                </button>
                <div style={{ fontSize: 11, color: '#9aa2c0' }}>
                  Käyttäjä voi itse vaihtaa tämän salasanan kirjautumissivun "Unohtuiko salasana?" -linkistä. Asentaja/Paaluttaja-tilit ilmestyvät Tiimit/Paalutus-välilehdille automaattisesti kun he kirjautuvat ensimmäistä kertaa.
                </div>
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 20, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1a6e' }}>Yrityksen käyttäjät</div>
                <button onClick={loadUsers} style={{ background: '#eef0f7', border: 'none', color: '#1560c4', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  🔄 Päivitä lista
                </button>
              </div>
              {usersLoading && <div style={{ fontSize: 13, color: '#9aa2c0' }}>Ladataan…</div>}
              {!usersLoading && companyUsers.length === 0 && (
                <div style={{ fontSize: 13, color: '#9aa2c0' }}>
                  Ei käyttäjiä listattavissa. Jos tämä on ensimmäinen kerta, varmista että manage-company-users-funktio on deployattu Supabaseen.
                </div>
              )}
              {companyUsers.map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f4f5fa', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{u.email}{u.id === session?.user?.id ? ' (sinä)' : ''}</div>
                    <div style={{ fontSize: 11, color: '#9aa2c0' }}>
                      {ROLE_LABEL[u.role] || u.role} · luotu {fmtTime(u.created_at)}
                    </div>
                  </div>
                  {u.id !== session?.user?.id && (
                    <button onClick={() => deleteUser(u)} title="Poista käyttäjä" style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 15, cursor: 'pointer', padding: '2px 4px' }}>🗑️</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'piling' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div style={{ ...cardStyle, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1a6e', marginBottom: 14 }}>Paaluttajat</div>
                {pileOperators.length === 0 && <div style={{ fontSize: 13, color: '#9aa2c0', marginBottom: 10 }}>Ei paaluttajia vielä</div>}
                {pileOperators.map(op => (
                  <div key={op.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f5fa', gap: 10 }}>
                    <span style={{ fontSize: 14 }}>{op.name}</span>
                    <button onClick={() => deletePileOperator(op)} title="Poista paaluttaja" style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 15, cursor: 'pointer', padding: '2px 4px' }}>🗑️</button>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#9aa2c0', marginTop: 18, lineHeight: 1.5 }}>
                  Uudet paaluttajat luodaan <b>Käyttäjät</b>-välilehdellä (rooli: Paaluttaja) — he ilmestyvät tähän listaan automaattisesti ensimmäisen kirjautumisen jälkeen.
                </div>
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1a6e' }}>Paalutuksen eteneminen</div>
                <select value={pileSiteFilter} onChange={e => setPileSiteFilter(e.target.value)} style={selectStyle}>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              {pileRowSummary.length === 0 && <EmptyState text="Ei paalutietoja — onko tuonti (?paalutuonti) ajettu?" />}

              {Object.entries(
                pileRowSummary.reduce((acc, r) => {
                  (acc[r.area] = acc[r.area] || []).push(r); return acc
                }, {})
              ).map(([area, rows]) => {
                const totalPiles = rows.reduce((s, r) => s + r.total_piles, 0)
                const donePiles = rows.reduce((s, r) => s + r.done_piles, 0)
                const doneRows = rows.filter(r => r.row_complete).length
                return (
                  <div key={area} style={{ marginBottom: 22 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e' }}>{area}</div>
                      <div style={{ fontSize: 12.5, color: '#6670a0' }}>{doneRows}/{rows.length} riviä · {donePiles}/{totalPiles} paalua</div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {rows.map(r => {
                        const key = `${area}__${r.row_number}`
                        const isOpen = expandedRowKey === key
                        return (
                          <div key={key} style={{ display: 'contents' }}>
                            <button
                              onClick={() => toggleRowExpand(area, r.row_number)}
                              style={{
                                padding: '6px 12px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
                                border: isOpen ? '1.5px solid #1560c4' : '1px solid #dfe2f0',
                                background: r.row_complete ? '#dcefe3' : '#f6f7fb',
                                color: r.row_complete ? '#1a7a50' : '#333',
                                fontWeight: isOpen ? 700 : 500,
                              }}
                            >
                              Rivi {r.row_number} · {r.done_piles}/{r.total_piles}{r.row_complete ? ' ✅' : ''}
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    {rows.some(r => `${area}__${r.row_number}` === expandedRowKey) && (
                      <div style={{ marginTop: 10, background: '#f9fafc', border: '1px solid #e5e8f2', borderRadius: 10, padding: 14, overflowX: 'auto' }}>
                        {expandedRowPiles == null ? (
                          <div style={{ fontSize: 13, color: '#9aa2c0' }}>Ladataan…</div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
                              <button
                                onClick={() => downloadRowFiles(area, Number(expandedRowKey.split('__')[1]))}
                                style={{ background: 'none', border: '1px solid #b8c0e8', color: '#1560c4', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                              >
                                ⬇️ Lataa PDF + Excel
                              </button>
                              <button
                                onClick={() => resetWholeRow(area, Number(expandedRowKey.split('__')[1]))}
                                style={{ background: 'none', border: '1px solid #e0b0b0', color: '#b02828', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                              >
                                🗑️ Tyhjennä koko rivi
                              </button>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                              <thead>
                                <tr>
                                  <th style={thStyle}>#</th>
                                  <th style={thStyle}>Koko</th>
                                  <th style={thStyle}>Lisätoimenpide</th>
                                  <th style={thStyle}>Vetotesti kN</th>
                                  <th style={thStyle}>Asentaja</th>
                                  <th style={thStyle}>Tila</th>
                                  <th style={thStyle}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedRowPiles.map((p, idx) => (
                                  editPileId === p.id ? (
                                    <tr key={p.id} style={{ background: '#eef1ff' }}>
                                      <td style={tdStyle}>{idx + 1}</td>
                                      <td style={tdStyle}>
                                        <select value={editPileType} onChange={e => setEditPileType(e.target.value)} style={{ ...selectStyle, padding: '4px 8px', fontSize: 12.5 }}>
                                          <option value="">–</option>
                                          {PILE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                                        </select>
                                      </td>
                                      <td style={tdStyle}>
                                        <select value={editPileExtra} onChange={e => setEditPileExtra(e.target.value)} style={{ ...selectStyle, padding: '4px 8px', fontSize: 12.5 }}>
                                          {EXTRA_ACTIONS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                                        </select>
                                      </td>
                                      <td style={tdStyle}>
                                        <input type="number" value={editPileKn} onChange={e => setEditPileKn(e.target.value)} style={{ ...selectStyle, padding: '4px 8px', fontSize: 12.5, width: 70 }} />
                                      </td>
                                      <td style={tdStyle}>{p.installed_by || '–'}</td>
                                      <td style={tdStyle}>{p.status === 'done' ? '✅' : '—'}</td>
                                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                                        <button onClick={() => saveEditPile(p.id)} style={{ background: '#1a7a45', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', marginRight: 4 }}>✓</button>
                                        <button onClick={() => setEditPileId(null)} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr key={p.id}>
                                      <td style={tdStyle}>{idx + 1}</td>
                                      <td style={tdStyle}>{typeLabel(p.pile_type) || '–'}</td>
                                      <td style={tdStyle}>{extraLabel(p.extra_action) || '–'}</td>
                                      <td style={tdStyle}>{p.pull_test_kn ?? '–'}</td>
                                      <td style={tdStyle}>{p.installed_by || '–'}</td>
                                      <td style={tdStyle}>{p.status === 'done' ? '✅' : '—'}</td>
                                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                                        <button onClick={() => startEditPile(p)} title="Muokkaa" style={{ background: 'none', border: 'none', color: '#1560c4', fontSize: 13, cursor: 'pointer', padding: '2px 6px' }}>✏️</button>
                                        <button onClick={() => resetPile(p.id)} title="Tyhjennä" style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 13, cursor: 'pointer', padding: '2px 6px' }}>🗑️</button>
                                      </td>
                                    </tr>
                                  )
                                ))}
                              </tbody>
                            </table>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(10,14,30,0.85)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}
        >
          <img
            src={lightboxSrc}
            alt="Korjauskuva"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}
          />
          <button
            onClick={() => setLightboxSrc(null)}
            style={{
              position: 'absolute', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer',
            }}
          >✕</button>
        </div>
      )}
    </div>
  )
}

function TeamCard({ team, installers, onDeleteTeam, onSetInstallerTeam }) {
  const [addId, setAddId] = useState('')
  const members = installers.filter(i => i.team_id === team.id)
  const available = installers.filter(i => i.team_id !== team.id)

  function addMember() {
    if (!addId) return
    onSetInstallerTeam(addId, team.id)
    setAddId('')
  }

  return (
    <div style={cardStyle}>
      <div style={{ padding: '13px 16px', background: '#f1ecfb', borderBottom: '1px solid #e4e7f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1a6e' }}>🧑‍🤝‍🧑 {team.name}</span>
        <button onClick={() => onDeleteTeam(team.id)} style={{ background: 'none', border: 'none', color: '#b02828', fontSize: 12, cursor: 'pointer' }}>Poista tiimi</button>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa2c0', marginBottom: 8, textTransform: 'uppercase' }}>Jäsenet ({members.length})</div>
        {members.length === 0 && <div style={{ fontSize: 13, color: '#9aa2c0', marginBottom: 8 }}>Ei jäseniä vielä</div>}
        {members.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f4f5fa' }}>
            <span style={{ fontSize: 13 }}>{m.name}</span>
            <button onClick={() => onSetInstallerTeam(m.id, null)} style={{ background: 'none', border: 'none', color: '#9aa2c0', fontSize: 12, cursor: 'pointer' }}>Poista tiimistä</button>
          </div>
        ))}

        {available.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <select value={addId} onChange={e => setAddId(e.target.value)} style={{ ...selectStyle, flex: 1, padding: '7px 10px', fontSize: 12.5 }}>
              <option value="">+ Lisää jäsen…</option>
              {available.map(i => <option key={i.id} value={i.id}>{i.name}{i.team_id ? ' (vaihda tiimistä)' : ''}</option>)}
            </select>
            <button onClick={addMember} disabled={!addId} style={{ background: addId ? '#1560c4' : '#c8cce0', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: addId ? 'pointer' : 'default' }}>
              Lisää
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#c0c4d8', marginTop: 12 }}>Kaikki asentajat ovat jo tässä tiimissä</div>
        )}
      </div>
    </div>
  )
}

function ObsRow({ o, fmtTime, selected, onToggle }) {
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f1f7', display: 'flex', gap: 10, alignItems: 'flex-start', background: selected ? '#f3f5ff' : 'transparent' }}>
      <input type="checkbox" checked={selected} onChange={onToggle} style={{ marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{o.cat}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: sevBg[o.sev], color: sevColor[o.sev], whiteSpace: 'nowrap', flexShrink: 0 }}>
            {o.sev}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#9aa2c0', marginTop: 3 }}>
          {o.site}{o.rivi ? ` · ${o.rivi}` : ''} · {fmtTime(o.created_at)}
        </div>
        {o.note && <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{o.note}</div>}
      </div>
    </div>
  )
}

function TableRow({ o, installerById, fmtTime, selected, onToggle, onOpenPhoto }) {
  return (
    <tr style={{ borderBottom: '1px solid #f0f1f7', background: selected ? '#f3f5ff' : 'transparent' }}>
      <td style={tdStyle}><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td style={tdStyle}>{o.cat}</td>
      <td style={tdStyle}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: sevBg[o.sev], color: sevColor[o.sev] }}>{o.sev}</span></td>
      <td style={tdStyle}>{o.site}{o.rivi ? ` · ${o.rivi}` : ''}</td>
      <td style={tdStyle}>{installerById.get(o.assigned_installer_id)?.name || '—'}</td>
      <td style={tdStyle}>{fmtTime(o.created_at)}</td>
      <td style={tdStyle}>{fmtTime(o.fixed_at)}</td>
      <td style={tdStyle}>
        {o.fixed_photo ? (
          <img
            src={o.fixed_photo}
            alt="Korjauskuva"
            onClick={() => onOpenPhoto(o.fixed_photo)}
            style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #d0d5e8', cursor: 'pointer' }}
          />
        ) : (
          <span style={{ color: '#c3c8dc', fontSize: 12 }}>—</span>
        )}
      </td>
    </tr>
  )
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(20,30,80,0.06), 0 1px 2px rgba(20,30,80,0.04)', padding: '17px 22px', minWidth: 140 }}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6670a0', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7.5px 14px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        background: active ? '#1560c4' : 'transparent', color: active ? '#fff' : '#4a5480',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function ActionBtn({ onClick, disabled, color, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px',
      fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
    }}>
      {children}
    </button>
  )
}

function EmptyState({ text }) {
  return (
    <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#6670a0', padding: 70, fontSize: 15, background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(20,30,80,0.06)' }}>
      {text}
    </div>
  )
}

const cardStyle = { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(20,30,80,0.06), 0 1px 2px rgba(20,30,80,0.04)', overflow: 'hidden' }
const selectStyle = { padding: '9px 12px', borderRadius: 8, border: '1px solid #d8dbee', fontSize: 13, background: '#fff', color: '#222' }
const thStyle = { padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#6670a0', textTransform: 'uppercase', letterSpacing: 0.3 }
const tdStyle = { padding: '10px 16px' }
