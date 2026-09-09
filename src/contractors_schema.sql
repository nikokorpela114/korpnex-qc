-- contractors_schema.sql
-- Lisää "urakoitsija" (yritys/aliurakoitsija) -käsitteen. Asentaja tai tiimi
-- voidaan liittää urakoitsijaan, ja Valvomo osaa sen jälkeen näyttää kaiken
-- urakoitsijakohtaisesti (avoimet+korjatut viat, läheltäpiti-ilmoitukset).
-- Lisäksi lisää observations-tauluun "type"-sarakkeen, jolla erotetaan
-- normaali vika-havainto läheltäpiti-ilmoituksesta.
--
-- Aja tämä kokonaisuudessaan Supabasen SQL Editorissa
-- (Dashboard → SQL Editor → New query), samaan tapaan kuin teams_schema.sql
-- aiemmin.

-- 1) Urakoitsijat
create table if not exists contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 2) Asentaja tai tiimi voi kuulua yhteen urakoitsijaan (valinnainen —
--    ilman urakoitsijaa asentaja/tiimi toimii täysin normaalisti kuten
--    ennenkin; havainto näkyy silloin Valvomon "Ei urakoitsijaa" -ryhmässä)
alter table installers add column if not exists contractor_id uuid references contractors(id) on delete set null;
alter table teams add column if not exists contractor_id uuid references contractors(id) on delete set null;

-- 3) Havainnon tyyppi: 'vika' (oletus, nykyinen käyttäytyminen) tai
--    'laheltapiti' (läheltäpiti-ilmoitus). Ei rajoiteta check-constraintilla,
--    jotta vanhat rivit (type = null) tulkitaan sovelluksessa aina "vika":ksi.
alter table observations add column if not exists type text;

-- 4) Oikeudet — sama malli kuin muillakin tauluilla (anon = sovelluksen oma
--    julkinen avain, service_role = Edge Functionit). Valvomon uusi
--    sähköposti+salasana-kirjautuminen (Supabase Auth) on tässä vaiheessa
--    vain käyttöliittymän portti — se EI muuta näitä oikeuksia, joten
--    kenttäsovellus (asentaja/paalutus) toimii täysin ennallaan.
grant select, insert, update, delete on contractors to anon, service_role;
