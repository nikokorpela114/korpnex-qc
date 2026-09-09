// supabase/functions/manage-valvomo-users/index.ts
//
// Valvomon käyttäjänhallinta (listaa / luo / poista Supabase Auth -tunnuksia).
// Tätä EI voi tehdä turvallisesti suoraan selaimesta anon-avaimella, koska
// uuden käyttäjän luonti/poisto vaatii Supabasen service_role-avaimen — se on
// salaisuus joka saa olla vain Edge Functionin puolella, ei koskaan
// selaimessa. Sen sijaan Valvomo (Dashboard.jsx) kutsuu tätä funktiota
// `sb.functions.invoke('manage-valvomo-users', ...)`, ja supabase-js liittää
// kutsuun automaattisesti soittajan oman kirjautuneen istunnon tokenin —
// funktio tarkistaa sen ensin, jotta kukaan kirjautumaton ei pääse luomaan
// itselleen tunnusta suoraan tätä funktiota kutsumalla.
//
// Deploy: supabase functions deploy manage-valvomo-users
// (SUPABASE_URL ja SUPABASE_SERVICE_ROLE_KEY ovat Supabasen automaattisesti
// tarjoamia ympäristömuuttujia, niitä ei tarvitse asettaa itse.)

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Varmista että pyynnön tekijä on jo kirjautunut Valvomon käyttäjä.
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token)
  if (callerErr || !callerData?.user) {
    return json({ error: 'Ei kirjautunut — kirjaudu Valvomoon uudelleen.' }, 401)
  }

  try {
    const { action, email, password, user_id } = await req.json()

    if (action === 'list') {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers()
      if (error) throw error
      const users = data.users
        .map(u => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at }))
        .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
      return json({ users })
    }

    if (action === 'create') {
      if (!email || !password || String(password).length < 6) {
        return json({ error: 'Sähköposti ja vähintään 6 merkin salasana vaaditaan' }, 400)
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: String(email).trim(),
        password: String(password),
        email_confirm: true, // ei vaadi sähköpostivahvistusta — kirjautuminen toimii heti
      })
      if (error) throw error
      return json({ ok: true, id: data.user?.id })
    }

    if (action === 'delete') {
      if (!user_id) return json({ error: 'user_id vaaditaan' }, 400)
      if (user_id === callerData.user.id) {
        return json({ error: 'Ei voi poistaa omaa tiliä täältä.' }, 400)
      }
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'Tuntematon toiminto' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: String(e?.message || e) }, 500)
  }
})
