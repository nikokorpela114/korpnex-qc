import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// HUOM (korjattu bugi, v2 — ensimmäinen yritys ei riittänyt): "Lisää Koti-
// valikkoon" (iOS) avasi Valvomon/Asentajan URL:sta huolimatta AINA
// Työnjohto-appin, JOPA sen jälkeen kun tämä koodi vaihtoi manifest-linkin/
// otsikon ajonaikaisesti DOM:issa. Syy selvisi vasta kun bugi toistui myös
// täysin tyhjässä Yksityinen selaus -istunnossa (ei mitään vanhaa
// välimuistia): iOS Safarin "Lisää Koti-valikkoon" lukee kotikuvakkeen
// kohteen/nimen sivun ALKUPERÄISESTÄ, PALVELIMEN TARJOAMASTA HTML:stä — ei
// JavaScriptin ajonaikaisesti muokkaamasta DOM:ista. Koska Valvomo/Työnjohto/
// Asentaja jakoivat SAMAN staattisen index.html-tiedoston (erottelu oli vain
// ?query-parametrilla), palvelin tarjosi AINA samaa, oletus-HTML:ää
// riippumatta query-parametrista — JS ehti vaihtaa sen vasta sivun latauduttua,
// mikä oli jo myöhässä.
//
// OIKEA korjaus (ks. App.jsx:n ja vite.config.js:n vastaavat HUOMit): jokainen
// näkymä sai OMAN, aidosti erillisen index.html:n omalla URL-POLULLAAN
// (/valvomo/, /asentaja/), joissa oikea manifesti/otsikko on VALMIIKSI
// HTML:ssä — ei enää JS:n varassa. Tämä alla oleva koodi on silti jätetty
// varmuuden vuoksi (esim. jos joku avaa vanhan ?asentaja-query-linkin
// suoraan juuripolulta) — se ei ole enää ainoa eikä ensisijainen korjaus.
;(function fixHomeScreenTarget() {
  try {
    const path = window.location.pathname
    const params = new URLSearchParams(window.location.search)
    const view = (path.startsWith('/asentaja') || params.has('asentaja')) ? 'asentaja'
      : (path.startsWith('/valvomo') || params.has('valvomo')) ? 'valvomo'
      : 'tyonjohto'
    const NAMES = { tyonjohto: 'Korpnex Työnjohto', valvomo: 'Korpnex Valvomo', asentaja: 'Korpnex Asentaja' }
    const name = NAMES[view]
    const manifestLink = document.getElementById('app-manifest')
    if (manifestLink) manifestLink.setAttribute('href', `/manifest-${view}.json`)
    const titleMeta = document.getElementById('apple-title-meta')
    if (titleMeta) titleMeta.setAttribute('content', name)
    document.title = name
  } catch (e) {
    console.error('fixHomeScreenTarget failed:', e)
  }
})()

// Rekisteröi Service Workerin heti (ei enää vain push-luvan yhteydessä),
// jotta se alkaa välimuistittaa sovellusta ja PDF/Excel-vientikirjastoja
// offline-käyttöä varten heti ensimmäisestä latauksesta lähtien.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
