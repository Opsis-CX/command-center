// Returns the caller's approximate location (Vercel IP geolocation headers)
// plus VPN / proxy / Tor / datacenter detection from ipapi.is. Detection needs
// the IPAPI_KEY env var in Vercel (free account, 1,000 lookups/day) — without
// it the flags come back null (unknown), never a false "clean".
// Used by the application form, the assessment, and login tracking.
export default async function handler(req, res) {
  const h = req.headers
  const dec = v => { try { return v ? decodeURIComponent(v) : null } catch { return v || null } }
  const num = v => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null)
  const ip = (h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || '').trim() || null

  let vpn = { is_vpn: null, is_proxy: null, is_tor: null, is_hosting: null, vpn_service: null }
  if (ip) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000)
      const key = process.env.IPAPI_KEY ? '&key=' + encodeURIComponent(process.env.IPAPI_KEY) : ''
      const r = await fetch('https://api.ipapi.is/?q=' + encodeURIComponent(ip) + key, { signal: ctl.signal })
      clearTimeout(t)
      if (r.ok) {
        const d = await r.json()
        const b = v => (typeof v === 'boolean' ? v : null)   // missing field = unknown, not "clean"
        vpn = {
          is_vpn: b(d.is_vpn), is_proxy: b(d.is_proxy), is_tor: b(d.is_tor), is_hosting: b(d.is_datacenter),
          vpn_service: (d.vpn && d.vpn.service) || null,
        }
      }
    } catch { /* lookup failed — return location only */ }
  }

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    ip,
    lat: num(h['x-vercel-ip-latitude']),
    lng: num(h['x-vercel-ip-longitude']),
    city: dec(h['x-vercel-ip-city']),
    region: dec(h['x-vercel-ip-country-region']),
    country: dec(h['x-vercel-ip-country']),
    ...vpn,
  })
}
