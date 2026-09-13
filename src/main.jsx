import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// KORJAUS: "Lisää Koti-valikkoon" (iOS) avasi Valvomon/Asentajan URL:sta
// huolimatta AINA Työnjohto-appin. Syy: index.html:n <link rel="manifest">
// oli kiinteä, ja nykyaikainen iOS Safari lukee koti-kuvakkeen kohteen (ja
// nimen) linkitetystä manifest.json:sta, EI siitä URL:sta millä oikeasti
// seisottiin kun "Lisää Koti-valikkoon" painettiin. Koska Valvomo/Työnjohto/
// Asentaja ovat samaa sivustoa erotettuna vain ?valvomo/?asentaja-query-
// parametrilla, kaikki kolme jakoivat saman manifestin (start_url "/") →
// kaikki kotikuvakkeet avasivat Työnjohdon.
//
// Korjattu vaihtamalla <link id="app-manifest"> ja <meta id="apple-title-
// meta">/<title> OIKEAAN, näkymäkohtaiseen manifestiin JA nimeen heti
// käynnistyksessä, ennen React-renderöintiä — jotta ne ovat oikein DOM:ssa
// hyvissä ajoin ennen kuin käyttäjä ehtii avata Jaa-valikon ja painaa
// "Lisää Koti-valikkoon". Jos käyttäjällä on jo VANHA, väärään paikkaan
// osoittava kotikuvake, se on poistettava ja lisättävä uudelleen — tämä
// korjaus vaikuttaa vain UUSIIN, tämän jälkeen lisättyihin kuvakkeisiin.
;(function fixHomeScreenTarget() {
  try {
    const params = new URLSearchParams(window.location.search)
    const view = params.has('asentaja') ? 'asentaja' : params.has('valvomo') ? 'valvomo' : 'tyonjohto'
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
