// src/phases.js — rakennustyömaan työvaiheet (pääotsikko + tarkennukset),
// runkorakennuksen tyypilliseen etenemisjärjestykseen perustuen. Käytetään
// sekä uuden havainnon työvaihevalikossa että PDF-raportin järjestyksessä
// (havainnot ryhmitellään ja järjestetään AINA tämän listan mukaisesti,
// riippumatta missä järjestyksessä ne on kentällä kirjattu).
//
// HUOM: vaiheet 1-3 (työmaan perustaminen / maanrakennustyöt ennen
// perustuksia) lisätään tähän listaan myöhemmin -- numerointi (4-20) on
// tarkoituksella sama kuin lopullisessa, täydessä listassa, jotta 1-3 voidaan
// lisätä myöhemmin tämän taulukon alkuun ilman että mikään muu numerointi
// muuttuu tai vanhoja havaintoja pitäisi järjestää uudelleen.
export const PHASES = [
  {
    key: 'perustusten-pohjatyot',
    order: 4,
    icon: '⛏️',
    label: '4. Perustusten pohjatyöt',
    subphases: [
      'Pohjan tasaus',
      'Suodatinkangas tarvittaessa',
      'Kapillaarikatko / sepelikerros',
      'Pohjan tiivistys',
      'Salaojaputkien asennus',
      'Salaojasepelit',
      'Salaojien tarkastuskaivot',
      'Perustusten vaatimat viemäri- ja putkiläpiviennit',
    ],
  },
  {
    key: 'perustukset',
    order: 5,
    icon: '🧱',
    label: '5. Perustukset',
    note: 'Riippuen talosta esimerkiksi:',
    subphases: [
      'Anturat',
      'Anturaraudoitukset',
      'Anturamuotit',
      'Anturabetonointi',
      'Perusmuuri / sokkeli',
      'Paalutus ja paalujen päälle tehtävät perustukset',
      'Sokkelin raudoitus',
      'Sokkelin muotitus',
      'Sokkelin betonointi',
      'Sokkelin vedeneristys',
      'Sokkelin routaeristys',
      'Perustusten täyttö',
    ],
  },
  {
    key: 'alapohja',
    order: 6,
    icon: '🏗️',
    label: '6. Alapohja',
    note: 'Esimerkiksi maanvaraisessa laatassa:',
    subphases: [
      'Täyttökerrokset',
      'Tiivistys',
      'Alapohjan eristeet',
      'Reunaeristeet',
      'Radonputkisto',
      'Alapohjan viemärit',
      'Vesijohtojen läpiviennit',
      'Mahdolliset lattialämmitysputket',
      'Raudoitus',
      'Betonilaatan valu',
      'Lattian kuivuminen',
    ],
  },
  {
    key: 'runko',
    order: 7,
    icon: '🏠',
    label: '7. Runko',
    note: 'Nyt talo alkaa oikeasti näyttää talolta.',
    subphases: [
      'Runkotavaran / elementtien vastaanotto',
      'Alajuoksut',
      'Ulkoseinien pystyrunko',
      'Väliseinien runko tarvittavilta osin',
      'Palkit ja kantavat rakenteet',
      'Ikkuna- ja oviaukkojen rakenteet',
      'Yläpohjan kantavat rakenteet',
      'Välipohja, jos talo on 2-kerroksinen',
    ],
  },
  {
    key: 'ylapohja-vesikatto',
    order: 8,
    icon: '🏚️',
    label: '8. Yläpohja ja vesikatto',
    note: 'Tässä vaiheessa rakennus saadaan yleensä säältä suojaan.',
    subphases: [
      'Kattotuolit / kattoristikot',
      'Aluskate',
      'Ruoteet',
      'Kattorakenteet',
      'Läpivientien valmistelu',
      'Vesikate',
      'Räystäät',
      'Kourut ja syöksytorvet',
      'Hormit ja kattoläpiviennit',
      'Katon pellitykset',
    ],
  },
  {
    key: 'ulkoseinat-julkisivu',
    order: 9,
    icon: '🧱',
    label: '9. Ulkoseinien rakenne ja julkisivu',
    note: 'Rakenteesta riippuen:',
    subphases: [
      'Tuulensuojalevy',
      'Tuulensuojakerros',
      'Ulkoseinän eristeet',
      'Koolaukset',
      'Julkisivun alusrakenteet',
      'Julkisivuverhous (puu / tiili / muu)',
      'Julkisivun pellitykset',
      'Nurkkalaudat / listoitukset',
      'Ulkopuolen ovet ja ikkunat',
      'Ulkopuolen tiivistykset',
    ],
  },
  {
    key: 'ikkunat-ulko-ovet',
    order: 10,
    icon: '🚪',
    label: '10. Ikkunat ja ulko-ovet',
    note: 'Tässä vaiheessa rakennus on käytännössä vesi- ja tuulitiivis.',
    subphases: [
      'Ikkunoiden asennus',
      'Ulko-ovien asennus',
      'Tiivistykset',
      'Pellitykset',
      'Vedenohjaukset',
    ],
  },
  {
    key: 'talotekniikka-1',
    order: 11,
    icon: '🔧',
    label: '11. Talotekniikan ensimmäinen asennuskierros',
    note: 'Tämä vaihe tehdään ennen kuin seinät ja katot suljetaan.',
    subphases: [
      'LVI: Vesijohtojen asennukset',
      'LVI: Viemäriputket',
      'LVI: Lämmitysputket',
      'LVI: Ilmanvaihtokanavat',
      'LVI: IV-koneen kanavoinnit',
      'LVI: Lämpöpumpun putkitukset',
      'LVI: Lattialämmitykset',
      'LVI: Muut tarvittavat putkitukset',
      'Sähkö: Sähköputket',
      'Sähkö: Kaapeloinnit',
      'Sähkö: Rasiat',
      'Sähkö: Kytkin- ja pistorasiapaikat',
      'Sähkö: Valaistuskaapeloinnit',
      'Sähkö: Data-/antennikaapeloinnit',
      'Sähkö: Palovaroittimien johdotukset',
      'Sähkö: Kodin automaation kaapeloinnit tarvittaessa',
    ],
  },
  {
    key: 'sisaseinat-ylapohja-eristys',
    order: 12,
    icon: '🧱',
    label: '12. Sisäseinien ja yläpohjan eristäminen',
    note: 'Tässä vaiheessa rakennuksen ilmatiiveyteen kiinnitetään erityistä huomiota.',
    subphases: [
      'Ulkoseinien lämmöneristeet',
      'Yläpohjan eristeet',
      'Väliseinien äänieristeet',
      'Höyrynsulku / ilmansulku',
      'Rakenneliitosten tiivistykset',
      'Läpivientien tiivistykset',
    ],
  },
  {
    key: 'levytys',
    order: 13,
    icon: '🪚',
    label: '13. Seinien ja kattojen levytys',
    note: 'Samalla tai hieman eri järjestyksessä tehdään tarvittavat sisärungot.',
    subphases: [
      'Kipsilevyt',
      'Märkätilojen levy-/rakenneratkaisut',
      'Kattojen levytys',
      'Saumaukset',
      'Tasoitukset',
      'Hionta',
    ],
  },
  {
    key: 'markatilat',
    order: 14,
    icon: '🚿',
    label: '14. Märkätilat',
    note: 'Esimerkiksi kylpyhuone, WC ja kodinhoitohuone:',
    subphases: [
      'Pohjien valmistelu',
      'Kaadot',
      'Lattialämmitys',
      'Vedeneristyksen pohjatyöt',
      'Vedeneristys',
      'Vedeneristyksen läpiviennit',
      'Vedeneristyksen tarkastus',
      'Laatoitus',
      'Saumaus',
      'Silikonit',
    ],
  },
  {
    key: 'sisapintojen-viimeistely',
    order: 15,
    icon: '🎨',
    label: '15. Sisäpintojen viimeistely',
    subphases: [
      'Seinien tasoitus',
      'Hionta',
      'Pohjamaalaus',
      'Maalaus',
      'Tapetointi tarvittaessa',
      'Sisäkattojen maalaus',
      'Listoitukset',
      'Sisäovet',
      'Karmit',
    ],
  },
  {
    key: 'lattiat',
    order: 16,
    icon: '🪵',
    label: '16. Lattiat',
    note: 'Lopullinen järjestys riippuu materiaalista, mutta esimerkiksi:',
    subphases: [
      'Lattian pohjan valmistelu',
      'Tasoitus tarvittaessa',
      'Lattiamateriaalin asennus',
      'Parketti / laminaatti / vinyyli / laatta',
      'Jalkalistat',
    ],
  },
  {
    key: 'talotekniikka-2',
    order: 17,
    icon: '⚡',
    label: '17. Talotekniikan toinen kierros',
    note: 'Kun pinnat ovat riittävän valmiit:',
    subphases: [
      'Sähkö: Pistorasiat',
      'Sähkö: Katkaisijat',
      'Sähkö: Valaisimet',
      'Sähkö: Keskuksen viimeistely',
      'Sähkö: Kodinkoneiden sähköliitännät',
      'Sähkö: Data- ja antenniliitännät',
      'LVI: WC-istuimet',
      'LVI: Altaat',
      'LVI: Hanat',
      'LVI: Suihkut',
      'LVI: Lattiakaivot',
      'LVI: Lämmityslaitteet',
      'LVI: IV-koneen käyttöönotto',
      'LVI: Ilmanvaihdon säätö',
    ],
  },
  {
    key: 'kiintokalusteet',
    order: 18,
    icon: '🍳',
    label: '18. Kiintokalusteet',
    subphases: [
      'Keittiön kalusteet',
      'Keittiötaso',
      'Allas',
      'Kodinkoneet',
      'Kylpyhuonekalusteet',
      'WC-kalusteet',
      'Vaatekaapit',
      'Muut kiintokalusteet',
    ],
  },
  {
    key: 'viimeistely',
    order: 19,
    icon: '🚪',
    label: '19. Viimeistely',
    subphases: [
      'Sisäovien lopullinen säätö',
      'Listat',
      'Peitelistat',
      'Kynnyslistat',
      'Kalusteiden viimeistely',
      'Silikonisaumat',
      'Maalausten paikkaukset',
      'Pienet korjaukset',
      'Puhdistus',
    ],
  },
  {
    key: 'piha-ulkotyot',
    order: 20,
    icon: '🌳',
    label: '20. Piha ja ulkopuoliset työt',
    note: 'Usein nämä tehdään loppupuolella, jotta raskas työmaaliikenne ei riko valmista pihaa.',
    subphases: [
      'Salaojien lopulliset täytöt',
      'Maanpintojen muotoilu',
      'Routasuojaukset',
      'Sokkelin vierustat',
      'Terassit',
      'Portaat',
      'Autopaikat',
      'Ajoväylät',
      'Kiveykset',
      'Nurmikko',
      'Istutukset',
      'Aidat',
      'Pihavalaistus',
      'Hulevesijärjestelmät',
    ],
  },
]

// "Muu / ei listalla" -- aina valittavissa jos työvaihe ei vielä ole listalla.
export const OTHER_PHASE = { key: 'muu', order: 999, icon: '📌', label: 'Muu / ei listalla', subphases: [] }

export function findPhase(key) {
  return PHASES.find(p => p.key === key) || OTHER_PHASE
}

export function phaseOrder(key) {
  return findPhase(key).order
}

// Ryhmittelee merkinnät työvaiheittain KANONISEEN järjestykseen (ei sen
// mukaan missä järjestyksessä ne on kentällä kirjattu) -- käytetään sekä
// projektinäkymässä että PDF-raportissa, jotta molemmat täsmäävät aina.
export function groupEntriesByPhase(entries) {
  const groups = new Map()
  for (const e of entries) {
    const k = e.phase_key || OTHER_PHASE.key
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(e)
  }
  const allPhases = [...PHASES, OTHER_PHASE]
  return [...groups.keys()]
    .sort((a, b) => phaseOrder(a) - phaseOrder(b))
    .map(key => ({ phase: allPhases.find(p => p.key === key) || OTHER_PHASE, rows: groups.get(key) }))
}
