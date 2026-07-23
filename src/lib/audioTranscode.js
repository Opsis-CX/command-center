// ============================================================
// audioTranscode.js — shared telephony-WAV → MP3 transcoder.
//
// Phone systems (Lightspeed etc.) export WAVs in codecs like GSM 6.10 that
// NO browser can decode — the file downloads fine but an <audio>/<video>
// element just shows 0:00. This lazy-loads ffmpeg.wasm (~30MB one-time per
// session) and converts such files to mp3 so they play in-app.
//
// Mirrors the proven logic used by ExternalQA's ensurePlayable (verified
// against a real GSM file from Lightspeed on 2026-07-16).
// ============================================================
const FF_VER = '0.12.10', FF_CORE = '0.12.6', FF_CDN = 'https://cdn.jsdelivr.net/npm'

// True when this WAV uses a codec browsers can't play (so it needs transcoding).
// Accepts a File or Blob. Non-WAV containers (mp3/m4a/ogg/webm) return false —
// browsers handle those natively.
export async function needsTranscode(fileOrBlob) {
  try {
    const head = new Uint8Array(await fileOrBlob.slice(0, 24).arrayBuffer())
    const tag = (o) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3])
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return false      // not a WAV — leave it alone
    const fmt = head[20] | (head[21] << 8)                         // WAV codec id
    return ![1, 3, 6, 7].includes(fmt)                             // PCM/float/a-law/u-law play fine
  } catch { return false }
}

export async function loadFFmpeg() {
  if (window.__opsisFF?.loaded) return window.__opsisFF
  const blobUrl = async (u, type) =>
    URL.createObjectURL(new Blob([await fetch(u).then(r => r.arrayBuffer())], { type }))
  if (!window.FFmpegWASM) {
    await new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = `${FF_CDN}/@ffmpeg/ffmpeg@${FF_VER}/dist/umd/ffmpeg.js`
      s.onload = res; s.onerror = () => rej(new Error('Could not load the audio converter.'))
      document.head.appendChild(s)
    })
  }
  const ff = new window.FFmpegWASM.FFmpeg()
  await ff.load({
    coreURL: await blobUrl(`${FF_CDN}/@ffmpeg/core@${FF_CORE}/dist/esm/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await blobUrl(`${FF_CDN}/@ffmpeg/core@${FF_CORE}/dist/esm/ffmpeg-core.wasm`, 'application/wasm'),
    classWorkerURL: await blobUrl(`${FF_CDN}/@ffmpeg/ffmpeg@${FF_VER}/dist/umd/814.ffmpeg.js`, 'text/javascript'),
  })
  window.__opsisFF = ff
  return ff
}

// Transcode a telephony WAV (File or Blob) to an mp3 Blob. Throws on failure.
export async function transcodeToMp3(blob) {
  const ff = await loadFFmpeg()
  const inName = 'in-' + Date.now() + '.wav'
  const outName = 'out-' + Date.now() + '.mp3'
  await ff.writeFile(inName, new Uint8Array(await blob.arrayBuffer()))
  const code = await ff.exec(['-i', inName, '-ac', '1', '-b:a', '64k', outName])
  if (code !== 0) throw new Error('convert failed')
  const out = await ff.readFile(outName)
  await ff.deleteFile(inName).catch(() => {}); await ff.deleteFile(outName).catch(() => {})
  return new Blob([out], { type: 'audio/mpeg' })
}
