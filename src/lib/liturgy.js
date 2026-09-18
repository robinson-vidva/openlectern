// Liturgy: creeds, prayers and responses said together. Built-in items come
// from src/data/liturgy.json (traditional public-domain wording); a church's
// own texts live in the session config (`config.liturgy`), so every controller
// in the session sees them and the creating device remembers them.
//
// An item: { id, title, keywords?, source?, lines: [{ text, role? }], lines2?,
// lang?, lang2?, custom? }. A line's role is 'leader' | 'people' | 'all'
// (default 'all' = unison). `lines2` is the same text in a second language.
import data from '../data/liturgy.json'
import { passagePages } from './resolve.js'

export const BUILTIN_LITURGY = data.items.map((it) => ({ ...it, lang: it.lang || 'en' }))

export const LITURGY_ROLES = ['leader', 'people', 'all']

// Custom first (a church's wording wins), then built-in.
export function allLiturgy(custom) {
  return [...(Array.isArray(custom) ? custom : []).map((it) => ({ ...it, custom: true })), ...BUILTIN_LITURGY]
}

export function liturgyById(custom, id) {
  if (!id) return null
  return allLiturgy(custom).find((it) => it.id === id) || null
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9஀-௿]+/g, ' ')
    .trim()
}

// Search by title / keywords: every word of the query must appear in the
// item's title or keywords (so "nicene" and "creed nicene" both hit).
export function searchLiturgy(custom, query) {
  const q = norm(query)
  if (!q) return []
  const words = q.split(' ').filter((w) => w.length >= 2)
  if (!words.length) return []
  return allLiturgy(custom).filter((it) => {
    const hay = norm([it.title, ...(it.keywords || [])].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

// Parse text typed by an operator: one line per screen line; a prefix marks a
// responsive role ("L:" / "P:" / "All:", or the words leader / people /
// congregation). Blank lines are skipped.
const ROLE_PREFIX = /^\s*(l|leader|p|people|cong|congregation|a|all)\s*[:：]\s*/i
export function parseLiturgyText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim()
      if (!line) return null
      const m = line.match(ROLE_PREFIX)
      if (!m) return { text: line }
      const tag = m[1].toLowerCase()
      const role = tag === 'l' || tag === 'leader' ? 'leader' : tag === 'a' || tag === 'all' ? 'all' : 'people'
      const rest = line.slice(m[0].length).trim()
      return rest ? { text: rest, role } : null
    })
    .filter(Boolean)
}

// The reverse, for editing: lines back to text with role prefixes.
export function liturgyToText(lines) {
  return (lines || [])
    .map((l) => (l.role && l.role !== 'all' ? `${l.role === 'leader' ? 'L' : 'P'}: ${l.text}` : l.text))
    .join('\n')
}

export function isResponsive(item) {
  return !!item?.lines?.some((l) => l.role && l.role !== 'all')
}

// The presenter display object for a liturgy item, in the same shape as a
// scripture passage so pagination, the mini preview and history all work.
// `roles` is per line; `unison` when every line is said by everyone.
export function liturgyCurrent(item) {
  const lines = item.lines || []
  const toVerses = (ls) => ls.map((l, i) => ({ n: i + 1, text: l.text, label: '' }))
  const roles = lines.map((l) => (LITURGY_ROLES.includes(l.role) ? l.role : 'all'))
  const cur = {
    id: crypto.randomUUID(),
    step: false,
    liturgy: item.id,
    reference: item.title,
    ref: null,
    primary: { language: item.lang || 'en', verses: toVerses(lines) },
    secondary: item.lines2?.length ? { language: item.lang2 || 'ta', verses: toVerses(item.lines2) } : null,
    roles,
    unison: roles.every((r) => r === 'all')
  }
  cur.pageCount = passagePages(cur).length || 1
  cur.page = 0
  return cur
}

export function newCustomId() {
  return `custom-${crypto.randomUUID().slice(0, 8)}`
}
