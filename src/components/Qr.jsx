import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

// Client-side QR (no network). Always dark-on-white for scannability regardless
// of the app theme. Auto-sizes the QR version to the text length.
export default function Qr({ text, size = 160, className, onClick }) {
  const { path, dim } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text || '')
    qr.make()
    const count = qr.getModuleCount()
    const margin = 4
    let d = ''
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`
      }
    }
    return { path: d, dim: count + margin * 2 }
  }, [text])

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label="QR code for the presenter link"
      shapeRendering="crispEdges"
      onClick={onClick}
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={path} fill="#111111" />
    </svg>
  )
}
