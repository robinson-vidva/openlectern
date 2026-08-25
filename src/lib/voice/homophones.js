// Common speech-recognition mishearings and loose spellings, mapped to book ids.
// These match at a lower ("fuzzy") confidence so AUTO mode never fires on them.
export const HOMOPHONES = {
  REV: ['revelations', 'the revelation', 'apocalypse', 'revelation of john'],
  SNG: ['songs of solomon', 'song of solomons', 'song of soloman', 'song of songs of solomon'],
  PHP: ['philippines', 'philipians', 'phillipians'],
  PHM: ['philemon'],
  MAT: ['mathew', 'saint matthew', 'st matthew'],
  MRK: ['saint mark', 'st mark'],
  LUK: ['saint luke', 'st luke'],
  JHN: ['saint john', 'st john'],
  PSA: ['psalter'],
  ECC: ['ecclesiastics'],
  PRO: ['proverb'],
  ZEP: ['sophonias', 'zephania'],
  OBA: ['abdias'],
  GAL: ['galations'],
  EPH: ['ephisians'],
  COL: ['colosians'],
  HAB: ['habakuk', 'habukkuk'],
  HAG: ['hagai'],
  ZEC: ['zachariah', 'zacharia', 'zecharia'],
  MAL: ['malachai', 'malakai'],
  NEH: ['nehemia'],
  DEU: ['duteronomy'],
  LEV: ['leviticas']
}

// Common spoken Tamil book-name variants that differ from the bundled index's
// canonical names -- most importantly the singular "Psalm" (சங்கீதம்) vs the
// index's plural (சங்கீதங்கள்). Matched as exact Tamil names, so a Tamil citation
// is high-confidence just like an English one.
export const TAMIL_ALIASES = {
  PSA: ['சங்கீதம்'],
  REV: ['வெளிப்படுத்தல்', 'வெளிப்பாடு', 'வெளிப்படுத்துதல்'],
  ACT: ['அப்போஸ்தலர்', 'அப்போஸ்தலர் நடபடிகள்'],
  MAT: ['மத்தேயு நற்செய்தி'],
  SNG: ['உன்னதப்பாட்டு']
}
