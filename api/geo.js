// Returns the caller's approximate location from Vercel's IP geolocation
// headers. Used by the public application form to record where an applicant
// applied from. No third-party service, no key.
export default function handler(req, res) {
  const h = req.headers
  const dec = v => { try { return v ? decodeURIComponent(v) : null } catch { return v || null } }
  const num = v => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null)
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    ip: (h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || '').trim() || null,
    lat: num(h['x-vercel-ip-latitude']),
    lng: num(h['x-vercel-ip-longitude']),
    city: dec(h['x-vercel-ip-city']),
    region: dec(h['x-vercel-ip-country-region']),
    country: dec(h['x-vercel-ip-country']),
  })
}
