// src/push.js
import { sb } from './supabaseClient'

// TÄRKEÄÄ: korvaa tämä sillä VAPID_PUBLIC_KEY-arvolla jonka sait — tämä on
// julkinen avain, se on turvallista pitää selainkoodissa.
export const VAPID_PUBLIC_KEY = 'BFayLujytsUxr9kvsNwWpiFBDBUzMs80iN5TM5zKup5S6PFyXx9Q-f8sgPe6nFtFTTe7PsBkDQCUczzTpK6nxgM'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

// Pyytää ilmoitusluvan, rekisteröi Service Workerin, tilaa pushin ja
// tallentaa tilauksen Supabaseen. Palauttaa true/false onnistumisesta.
// role: 'installer' | 'supervisor'. installerId: pakollinen jos role==='installer'.
// companyId: PAKOLLINEN moniyritysversiossa — ilman sitä RLS estäisi rivin
// tallennuksen (push_subscriptions.company_id täytyy täsmätä kirjautuneen
// käyttäjän omaan yritykseen, ks. multi_tenant_schema.sql). Tämä samalla
// varmistaa että send-push-funktio voi rajata ilmoitukset oikeaan yritykseen
// eivätkä eri yritysten ilmoitukset koskaan mene ristiin.
export async function subscribeToPush(role, installerId = null, companyId = null) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'Selain ei tue push-ilmoituksia' }
  }
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, reason: 'Lupa evätty' }

    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    // Älä kasaa uutta riviä joka kerta kun nappia painetaan samalla
    // laitteella — lisää vain jos täsmälleen tämä tilaus ei ole jo tallessa.
    const { data: existing } = await sb.from('push_subscriptions')
      .select('id')
      .eq('subscription->>endpoint', sub.endpoint)
      .eq('role', role)
      .maybeSingle()

    if (!existing) {
      const { error } = await sb.from('push_subscriptions').insert([{
        role, installer_id: installerId, company_id: companyId, subscription: sub.toJSON(),
      }])
      if (error) return { ok: false, reason: error.message }
    }

    return { ok: true }
  } catch (e) {
    console.error('subscribeToPush failed:', e)
    return { ok: false, reason: e.message }
  }
}

// Tarkistaa onko tällä laitteella jo voimassaoleva tilaus — käytetään
// näyttämään "Ilmoitukset päällä" heti sivun latauduttua, sen sijaan että
// nappi näyttäisi aina oletustekstiä vaikka tilaus olisi jo aktiivinen.
export async function getPushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    return !!sub && Notification.permission === 'granted'
  } catch {
    return false
  }
}

// Kutsuu send-push-Edge Functionia joka oikeasti lähettää ilmoitukset.
// Kutsutaan työnjohtajan sovelluksesta kun havaintoja lähetetään
// asentajalle, ja asentajan sovelluksesta kun havainto merkitään korjatuksi.
//
// HUOM (moniyritysversio): tämä kutsutaan nyt sb.functions.invoke:lla
// (aiemmin suora fetch + kovakoodattu anon-avain) — supabase-js liittää
// automaattisesti kirjautuneen käyttäjän istunnon tokenin mukaan.
// send-push-funktio TARKISTAA tämän tokenin ja rajaa ilmoitukset AINA
// kutsujan omaan yritykseen palvelinpäässä — se ei koskaan luota tähän
// mahdollisesti annettuun companyId-arvoon, joten yritysten väliset
// ilmoitusvuodot eivät ole mahdollisia vaikka kutsuva koodi olisi väärässä.
export async function sendPushNotification({ role, installerId = null, title, body = '', url = '/', tag }) {
  try {
    const { data, error } = await sb.functions.invoke('send-push', {
      body: { role, installer_id: installerId, title, body, url, tag },
    })
    if (error) {
      console.error('sendPushNotification failed:', error)
      return { error: error.message }
    }
    if (data?.error) {
      console.error('sendPushNotification: server error', data.error)
      return data
    }
    return data
  } catch (e) {
    console.error('sendPushNotification failed:', e)
    return { error: e.message }
  }
}
