// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ddgsbamrafhasrtsrsyv.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkZ3NiYW1yYWZoYXNydHNyc3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyODU2MzUsImV4cCI6MjA5Nzg2MTYzNX0.gsbIu5yAUA_iINCGF20p4bSAWJCaEN6UXi8_OlGC3Oc'

// HUOM (moniyritys-versio, session-eristys): Valvomo, Työnjohto ja Asentaja
// ovat samaa sivustoa/samaa Supabase-projektia. Oletuksena
// @supabase/supabase-js tallentaa kirjautumisistunnon SELAIMEN localStorageen
// yhdellä, sivustokohtaisella avaimella — jolloin kaikki kolme "appia"
// jakaisivat SAMAN istunnon: kirjautuminen yhteen näkyisi/toimisi myös
// muissa (selain synkkaa istunnon kaikkiin samalla origin:illa auki oleviin
// välilehtiin). Tämä näkyi käytännössä niin, että Asentaja-tilillä
// kirjautuminen sai Valvomon ja Työnjohdon näyttämään "väärä rooli" -viestin
// SAMALLA tilillä sen sijaan että ne olisivat näyttäneet tavallisen, tyhjän
// kirjautumisnäytön — eli kaikki kolme näyttivät "linkittyvän toisiinsa".
//
// Roolitarkistus (AuthGate allowedRoles) esti jo silti pääsyn oikeasti
// vääriin näkymiin — tämä ei siis ollut tietoturva-aukko — mutta jotta kolme
// näkymää käyttäytyvät myös SESSION-tasolla aidosti erillisinä sovelluksina
// (kuten pyysit), annetaan jokaiselle omat, toisistaan riippumattomat
// storageKeyt. Kirjautuminen yhteen ei siis enää millään tavalla vaikuta
// toisiin — jokainen näkymä vaatii aina oman, erillisen kirjautumisensa,
// vaikka samalla sähköposti+salasana-tilillä (esim. Valvomon pääkäyttäjä,
// jolla on pääsy joka näkymään, kirjautuu jokaiseen erikseen).
//
// HUOM (korjattu bugi — iOS "Lisää Koti-valikkoon" avasi aina Työnjohto-
// appin): näkymä tunnistetaan ENSISIJAISESTI URL-POLUSTA (/valvomo/,
// /asentaja/), koska nämä ovat nyt aidosti erillisiä, omia index.html-
// tiedostojaan (ks. vite.config.js). Vanhat ?valvomo/?asentaja-query-
// parametrit tunnistetaan edelleen varalta (esim. vanhat tallennetut
// linkit), mutta UUDET koti-kuvakkeet tehdään aina /valvomo/- ja
// /asentaja/-poluista.
function detectAppContext() {
  if (typeof window === 'undefined') return 'tyonjohto'
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)
  if (path.startsWith('/asentaja') || params.has('asentaja')) return 'asentaja'
  if (path.startsWith('/valvomo') || params.has('valvomo')) return 'valvomo'
  return 'tyonjohto'
}

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: `sb-korpnex-${detectAppContext()}-auth-token` },
})
