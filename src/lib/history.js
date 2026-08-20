// Pure history helper. Newest-first list of shown references, capped, with
// consecutive-duplicate dedupe (re-showing the same ref just refreshes the top
// entry's time/source instead of adding a row).
export function appendHistory(history, entry, cap = 100) {
  const list = Array.isArray(history) ? history : []
  const next =
    list[0] && list[0].ref === entry.ref
      ? [{ ...entry }, ...list.slice(1)]
      : [{ ...entry }, ...list]
  return next.slice(0, cap)
}
