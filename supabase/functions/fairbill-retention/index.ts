Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const token = request.headers.get('x-fairbill-retention');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return new Response(null, { status: 401 });

  const origin = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!origin || !key) return new Response(null, { status: 503 });
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  try {
    const batch = await fetch(`${origin}/rest/v1/rpc/fairbill_retention_batch`, {
      method: 'POST', headers, body: JSON.stringify({ p_token: token }), signal: AbortSignal.timeout(12000),
    });
    if (!batch.ok) return new Response(null, { status: 503 });
    const names: string[] | null = await batch.json();
    if (names === null) return new Response(null, { status: 401 });
    if (names.length) {
      const deletion = await fetch(`${origin}/storage/v1/object/fairbill-originals`, {
        method: 'DELETE', headers, body: JSON.stringify({ prefixes: names }), signal: AbortSignal.timeout(12000),
      });
      if (!deletion.ok) return new Response(null, { status: 503 });
    }
    return Response.json({ originalsRequestedForRemoval: names.length });
  } catch {
    return new Response(null, { status: 503 });
  }
});
