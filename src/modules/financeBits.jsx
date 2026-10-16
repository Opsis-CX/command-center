import React from 'react'
import { supabase } from '../lib/supabase'

// Shared helpers for the finance screens (Submit a purchase, Finance).

export const BUCKET = 'finance-files'
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
export const MAX_BYTES = 15 * 1024 * 1024

export const money = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
export const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
export const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

const STATUS = {
  received:   ['Received', 'needed'],
  needs_info: ['Needs information', 'failed'],
  approved:   ['Approved', 'passed'],
  rejected:   ['Rejected', 'failed'],
  reimbursed: ['Reimbursed', 'passed'],
}
export function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, '']
  return <span className={`badge ${cls}`}>{label}</span>
}

// Returns an error message if the file can't be used, otherwise ''.
export function receiptProblem(file) {
  if (!file) return ''
  if (file.size > MAX_BYTES) return 'That file is larger than 15 MB. Please use a smaller photo or PDF.'
  const okType = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i.test(file.type || '')
  const okName = /\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(file.name || '')
  if (!okType && !okName) return 'Please attach a photo (JPG, PNG, HEIC) or a PDF.'
  return ''
}

// Uploads into the private finance-files area and returns the stored path.
export async function uploadReceipt(file, folder) {
  const safe = (file.name || 'receipt').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `${folder}/${Date.now()}-${safe}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw error
  return path
}

// Short-lived link to a stored receipt (the database decides who may ask for one).
export async function openReceipt(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) throw (error || new Error('Could not open that file.'))
  window.open(data.signedUrl, '_blank', 'noopener')
}

export function downloadCsv(filename, header, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const text = [header, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function Toast({ text }) {
  if (!text) return null
  return <div role="status" style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--ink)', color: '#fff', padding: '11px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>{text}</div>
}

export const panel = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '18px 20px' }
