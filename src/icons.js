// Inline SVG icons (24x24, currentColor stroke).

const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  forward: '<path d="M9 18l6-6-6-6"/>',
  moon: '<path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  collapse: '<path d="M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6"/>',
  pen: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10z"/><path d="M14 7l3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  cut: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6L20 18M8.6 15.4L20 6"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M14 11v6M11 14h6"/><path d="M4 16V6a2 2 0 012-2h10"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-4.4-4-7.6-9-7.6z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8" r="1.2" fill="currentColor"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  pages: '<rect x="4" y="3" width="7" height="8" rx="1.5"/><rect x="13" y="3" width="7" height="8" rx="1.5"/><rect x="4" y="13" width="7" height="8" rx="1.5"/><rect x="13" y="13" width="7" height="8" rx="1.5"/>',
  tray: '<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M7 21h12a2 2 0 002-2V9"/><path d="M3 14l4-4 4 4 2-2 4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
  settings: '<path d="M4 6h9M19 6h1M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="16" cy="6" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="18" r="2.2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  lasso: '<ellipse cx="12" cy="10" rx="8.5" ry="6" stroke-dasharray="3 2.4"/><path d="M8.2 15.4c-.9 1.4-.4 2.9.9 3.6.9.5 1.2 1.4.8 2.4"/>',
  snip: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M8 15.5l2.6-3.2 2.1 2.1 1.5-1.6 1.8 2.7"/><circle cx="9.5" cy="9" r="1.2"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1.5" stroke-dasharray="3 2.5"/>',
  freeform: '<path stroke-dasharray="3 2.5" d="M6 7c3-4 10-3 12 1s1 9-4 10-9 0-10-4 0-5 2-7z"/>',
  eraser: '<path d="M16.2 4.6l3.2 3.2a1.8 1.8 0 010 2.5L11 18.7H7.4l-3-3a1.8 1.8 0 010-2.5l9.3-9.3a1.8 1.8 0 012.5 0z"/><path d="M8.8 9.2l5.9 5.9M11 18.7h9"/>',
  eraseStroke: '<path d="M3 15c3-6 5-6 6-3s3 3 5-1"/><path d="M16 14l5 5M21 14l-5 5"/>',
  eraseArea: '<circle cx="12" cy="12" r="7.5" stroke-dasharray="3 2.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  book: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  backup: '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  shapes: '<circle cx="8" cy="8" r="4.5"/><rect x="11" y="11" width="9" height="9" rx="1.2"/>',
  plain: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10z"/><path d="M14 7l3 3"/>',
  // Pens (drawn vertical, then rotated)
  fountain: '<g transform="rotate(40 12 12)"><path d="M10 2h4v8.5l2 3.5-4 8-4-8 2-3.5z"/><path d="M12 15.5v3.5"/></g>',
  ballpoint: '<g transform="rotate(40 12 12)"><path d="M10 2h4v13l-2 5.5-2-5.5z"/><path d="M10 14.5h4"/></g>',
  brush: '<g transform="rotate(40 12 12)"><path d="M10.5 2h3v9.5h-3z"/><path d="M9.8 11.5h4.4c0 4.2-1 7.3-2.2 10.5-1.2-3.2-2.2-6.3-2.2-10.5z"/></g>',
  pencil: '<g transform="rotate(40 12 12)"><path d="M10 2h4v14l-2 5.5-2-5.5z"/><path d="M10 15.8h4M11.3 19.2h1.4"/></g>',
  highlighter: '<g transform="rotate(40 12 12)"><path d="M9 2h6v10.5l-1.5 2v3.5L10.5 21v-6.5L9 12.5z"/><path d="M9 10h6"/></g>',
}

export function icon(name, size = 22) {
  const span = document.createElement('span')
  span.className = 'ic'
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`
  return span
}
