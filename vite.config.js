import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// HUOM (korjattu bugi — iOS "Lisää Koti-valikkoon" avasi aina Työnjohto-
// appin): Valvomo/Työnjohto/Asentaja erotettiin aiemmin VAIN URL:n query-
// parametrilla (?valvomo/?asentaja), ja kaikki kolme jakoivat SAMAN
// index.html-tiedoston. iOS Safarin "Lisää Koti-valikkoon" lukee
// kotikuvakkeen kohteen/nimen suoraan palvelimen tarjoamasta HTML:stä — ei
// query-parametrista eikä JS:n ajonaikaisesti muokkaamasta DOM:ista — niin
// yksi jaettu tiedosto ei voinut koskaan tarjota kolmea eri lopputulosta.
// Korjattu Viten "multi-page app" -builditilalla: jokaiselle näkymälle
// oma, aidosti erillinen lähde-HTML (index.html, valvomo/index.html,
// asentaja/index.html — jokaisella oma <link rel="manifest">/<title>
// valmiiksi HTML:ssä), jotka kaikki latautuvat samaan src/main.jsx-
// sovelluskoodiin. Netlify tarjoaa nämä build-tuloksen polkujen mukaan
// (/valvomo/, /asentaja/) automaattisesti, ilman erillisiä redirect-
// sääntöjä. Vanhat ?asentaja/?valvomo-query-parametrit toimivat edelleen
// juuripolulla (App.jsx/supabaseClient.js tunnistavat molemmat), mutta
// UUDET koti-kuvakkeet pitää tehdä /valvomo/- ja /asentaja/-osoitteilta.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        valvomo: resolve(__dirname, 'valvomo/index.html'),
        asentaja: resolve(__dirname, 'asentaja/index.html'),
      }
    }
  }
})
