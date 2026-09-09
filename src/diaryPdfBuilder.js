// src/diaryPdfBuilder.js — kokoaa yhden päiväkirjaprojektin kaikki
// merkinnät yhdeksi PDF:ksi, työvaiheittain KANONISEEN järjestykseen
// ryhmiteltynä (ks. phases.js:n groupEntriesByPhase) — riippumatta siitä
// missä järjestyksessä kuvat on kentällä otettu. Kuvat haetaan Supabase
// Storagesta lyhytikäisellä allekirjoitetulla URL:lla (bucket "diary-
// photos" on yksityinen), joten tämä vaatii toimivan verkkoyhteyden
// raportin luontihetkellä.
//
// Sovitettu moniyritysversioon alkuperäisestä (erillisen Rakennuspäiväkirja-
// sovelluksen) pdfBuilder.js:stä: bucket "site-photos" -> "diary-photos",
// otsikkovärit yhtenäistetty muun sovelluksen navy-brändiin (#070b17), ja
// alatunnisteen yrityksen nimi tulee parametrina (ei enää kovakoodattua
// "Korpnex Oy").
import { sb } from './supabaseClient.js'
import { groupEntriesByPhase } from './phases.js'

async function fetchPhotoDataUrl(photoPath) {
  if (!photoPath) return null
  try {
    const { data, error } = await sb.storage.from('diary-photos').createSignedUrl(photoPath, 300)
    if (error || !data?.signedUrl) return null
    const res = await fetch(data.signedUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch (e) {
    console.error('fetchPhotoDataUrl failed:', e)
    return null
  }
}

function getImageSize(dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 })
    img.onerror = () => resolve({ w: 800, h: 600 })
    img.src = dataUrl
  })
}

// entries: valitun projektin merkintä-rivit tietokannasta.
// companyName: näytetään PDF:n alatunnisteessa (korvaa vanhan kovakoodatun "Korpnex Oy":n).
// onProgress(done, total): valinnainen edistymisen seuranta ison projektin kuvien latauksen ajaksi.
// Palauttaa { blob, filename }.
export async function buildDiaryPDF({ projectName, entries, companyName, onProgress }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 14, CW = W - M * 2
  let y = 18
  const dateStr = new Date().toLocaleDateString('fi-FI')
  const footerCompany = companyName || 'Korpnex'

  function drawHeader(withTitle) {
    doc.setFillColor(7, 11, 23) // #070b17
    doc.rect(0, 0, W, 26, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255)
    doc.text('KORPNEX', M, 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(255, 255, 255)
    doc.text('Päiväkirja', M, 18)
    doc.setFontSize(9); doc.setTextColor(190, 196, 220)
    doc.text(dateStr, W - M, 11, { align: 'right' })
    y = 36
    if (withTitle) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 24, 58)
      doc.text(projectName || 'Projekti', M, y)
      y += 10
      doc.setDrawColor(200, 203, 215); doc.line(M, y, W - M, y); y += 8
    }
  }
  drawHeader(true)

  const ensureSpace = (needed) => { if (y + needed > 282) { doc.addPage(); drawHeader(false) } }

  if (entries.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120, 124, 145)
    doc.text('Ei vielä merkintöjä tässä projektissa.', M, y)
  }

  const groups = groupEntriesByPhase(entries)
  let done = 0
  const total = entries.length

  for (const { phase, rows } of groups) {
    const sorted = rows.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

    ensureSpace(16)
    doc.setFillColor(238, 240, 245); doc.rect(M, y, CW, 9, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(7, 11, 23)
    // HUOM: jsPDF:n vakiofontit (Helvetica) eivät osaa piirtää emojeja --
    // vain phase.label (ei phase.icon) tulostetaan PDF:ään.
    doc.text(phase.label, M + 3, y + 6.2)
    y += 14

    for (const e of sorted) {
      ensureSpace(14)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20, 24, 58)
      doc.text(e.subphase || '(ei tarkennusta)', M, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150, 154, 170)
      const who = e.created_by_name ? `${e.created_by_name} · ` : ''
      const timeStr = e.created_at ? new Date(e.created_at).toLocaleString('fi-FI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
      doc.text(`${who}${timeStr}`, W - M, y, { align: 'right' })
      y += 6

      const dataUrl = await fetchPhotoDataUrl(e.photo_path)
      done++; onProgress?.(done, total)
      if (dataUrl) {
        const dims = await getImageSize(dataUrl)
        const sc = Math.min((CW - 4) / dims.w, 130 / dims.h)
        const dw = dims.w * sc, dh = dims.h * sc
        ensureSpace(dh + 6)
        try { doc.addImage(dataUrl, 'JPEG', M, y, dw, dh) } catch (err) { console.error('addImage failed:', err) }
        y += dh + 4
      }
      if (e.note) {
        ensureSpace(8)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40)
        const lines = doc.splitTextToSize(e.note, CW)
        doc.text(lines, M, y); y += lines.length * 4.6 + 2
      }
      y += 6
    }
  }

  const tp = doc.getNumberOfPages()
  for (let p = 1; p <= tp; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(160, 160, 160)
    doc.text(`${footerCompany} · Päiväkirja · ${dateStr}`, M, 292)
    doc.text(`${p} / ${tp}`, W - M, 292, { align: 'right' })
  }

  const blob = doc.output('blob')
  const filename = `Paivakirja_${(projectName || 'projekti').replace(/\s+/g, '_')}_${dateStr.replace(/\./g, '-')}.pdf`
  return { blob, filename }
}
