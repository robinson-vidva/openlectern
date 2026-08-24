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
