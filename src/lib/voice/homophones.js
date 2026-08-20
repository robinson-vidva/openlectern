// Common speech-recognition mishearings and loose spellings, mapped to book ids.
// These match at a lower ("fuzzy") confidence so AUTO mode never fires on them.
export const HOMOPHONES = {
  REV: ['revelations', 'the revelation', 'apocalypse', 'revelation of john'],
  SNG: ['songs of solomon', 'song of solomons', 'song of soloman', 'song of songs of solomon'],
  PHP: ['philippines'],
  PHM: ['philemon'],
  MAT: ['mathew', 'saint matthew', 'st matthew'],
  MRK: ['saint mark', 'st mark'],
  LUK: ['saint luke', 'st luke'],
  JHN: ['saint john', 'st john'],
  PSA: ['psalter'],
  ECC: ['ecclesiastics'],
  PRO: ['proverb'],
  ZEP: ['sophonias'],
  OBA: ['abdias']
}
