// Utterance -> expected reference (or null for "must not match").
// Positives assert the TOP-ranked candidate. Validated against the real WEB
// (eng-web) verse structure by the test.
export const FIXTURES = [
  // --- digits ---
  { text: 'John 3 16', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'John 3:16', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'Genesis 1 1', expect: { bookId: 'GEN', chapter: 1, verseStart: 1, verseEnd: null } },
  { text: 'Romans 8 28', expect: { bookId: 'ROM', chapter: 8, verseStart: 28, verseEnd: null } },

  // --- number words ---
  { text: 'John three sixteen', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'John chapter three verse sixteen', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'John chapter 3 verse 16', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'Matthew five nine', expect: { bookId: 'MAT', chapter: 5, verseStart: 9, verseEnd: null } },
  { text: 'Psalm one hundred and nineteen verse one oh five', expect: { bookId: 'PSA', chapter: 119, verseStart: 105, verseEnd: null } },
  { text: 'Psalm one hundred nineteen', expect: { bookId: 'PSA', chapter: 119, verseStart: null, verseEnd: null } },
  { text: 'Genesis chapter one verse one', expect: { bookId: 'GEN', chapter: 1, verseStart: 1, verseEnd: null } },
  { text: 'Acts two thirty eight', expect: { bookId: 'ACT', chapter: 2, verseStart: 38, verseEnd: null } },

  // --- ordinal books ---
  { text: 'first Corinthians 13', expect: { bookId: '1CO', chapter: 13, verseStart: null, verseEnd: null } },
  { text: 'first Corinthians thirteen four', expect: { bookId: '1CO', chapter: 13, verseStart: 4, verseEnd: null } },
  { text: 'second Timothy 2', expect: { bookId: '2TI', chapter: 2, verseStart: null, verseEnd: null } },
  { text: '1st John 4 8', expect: { bookId: '1JN', chapter: 4, verseStart: 8, verseEnd: null } },
  { text: '2 Peter 1 4', expect: { bookId: '2PE', chapter: 1, verseStart: 4, verseEnd: null } },
  { text: '3 John 4', expect: { bookId: '3JN', chapter: 1, verseStart: 4, verseEnd: null } },
  { text: 'second Samuel 22 2', expect: { bookId: '2SA', chapter: 22, verseStart: 2, verseEnd: null } },

  // --- ranges ---
  { text: 'John 3 16 to 18', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: 18 } },
  { text: 'Romans 8 verses three to five', expect: { bookId: 'ROM', chapter: 8, verseStart: 3, verseEnd: 5 } },
  { text: 'Psalm 23 verses 1 through 6', expect: { bookId: 'PSA', chapter: 23, verseStart: 1, verseEnd: 6 } },
  { text: 'Matthew 5 verses three through ten', expect: { bookId: 'MAT', chapter: 5, verseStart: 3, verseEnd: 10 } },

  // --- chapter-only ---
  { text: 'Psalm 23', expect: { bookId: 'PSA', chapter: 23, verseStart: null, verseEnd: null } },
  { text: 'John chapter 3', expect: { bookId: 'JHN', chapter: 3, verseStart: null, verseEnd: null } },
  { text: 'first Corinthians chapter thirteen', expect: { bookId: '1CO', chapter: 13, verseStart: null, verseEnd: null } },
  { text: 'Revelation 22', expect: { bookId: 'REV', chapter: 22, verseStart: null, verseEnd: null } },

  // --- book fuzziness / homophones ---
  { text: 'revelations 22 21', expect: { bookId: 'REV', chapter: 22, verseStart: 21, verseEnd: null } },
  { text: 'songs of solomon 2 1', expect: { bookId: 'SNG', chapter: 2, verseStart: 1, verseEnd: null } },
  { text: 'song of solomon 2 1', expect: { bookId: 'SNG', chapter: 2, verseStart: 1, verseEnd: null } },
  { text: 'philippines 4 6 to 7', expect: { bookId: 'PHP', chapter: 4, verseStart: 6, verseEnd: 7 } },
  { text: 'phillipians 4 6', expect: { bookId: 'PHP', chapter: 4, verseStart: 6, verseEnd: null } },
  { text: 'galations 5 22', expect: { bookId: 'GAL', chapter: 5, verseStart: 22, verseEnd: null } },
  { text: 'zachariah 4 6', expect: { bookId: 'ZEC', chapter: 4, verseStart: 6, verseEnd: null } },
  { text: 'habakuk 2 4', expect: { bookId: 'HAB', chapter: 2, verseStart: 4, verseEnd: null } },
  { text: 'mathew 6 33', expect: { bookId: 'MAT', chapter: 6, verseStart: 33, verseEnd: null } },
  { text: 'ps 23 1', expect: { bookId: 'PSA', chapter: 23, verseStart: 1, verseEnd: null } },

  // --- "verse number N" filler ---
  { text: 'John chapter 3 verse number 16', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'Romans chapter number eight verse number twenty eight', expect: { bookId: 'ROM', chapter: 8, verseStart: 28, verseEnd: null } },

  // --- number-word homophones (recognizer hears "four"->"for", "eight"->"ate") ---
  // Accepted only when context confirms a number (an explicit "verse" or "and N").
  { text: 'Psalms 91 for and five', expect: { bookId: 'PSA', chapter: 91, verseStart: 4, verseEnd: 5 } },
  { text: 'Psalm 91 for through five', expect: { bookId: 'PSA', chapter: 91, verseStart: 4, verseEnd: 5 } },
  { text: 'Psalms 91 verse for', expect: { bookId: 'PSA', chapter: 91, verseStart: 4, verseEnd: null } },
  { text: 'Matthew 5 verse ate', expect: { bookId: 'MAT', chapter: 5, verseStart: 8, verseEnd: null } },
  // Safety: a homophone in ordinary speech must NOT become a verse. "Romans 8,
  // for I am persuaded" (the wording of Romans 8:38) stays chapter-only.
  { text: 'Romans 8 for I am persuaded', expect: { bookId: 'ROM', chapter: 8, verseStart: null, verseEnd: null } },
  { text: 'John 3 for God so loved the world', expect: { bookId: 'JHN', chapter: 3, verseStart: null, verseEnd: null } },
  { text: 'we ate lunch at noon', expect: null },

  // --- single-chapter verse-only ---
  { text: 'Jude 5', expect: { bookId: 'JUD', chapter: 1, verseStart: 5, verseEnd: null } },
  { text: 'Jude verse 5', expect: { bookId: 'JUD', chapter: 1, verseStart: 5, verseEnd: null } },

  // --- cross-chapter ranges ---
  { text: 'Matthew chapters five through seven', expect: { bookId: 'MAT', chapter: 5, verseStart: null, endChapter: 7, verseEnd: null } },
  { text: 'Matthew five through seven', expect: { bookId: 'MAT', chapter: 5, verseStart: null, endChapter: 7, verseEnd: null } },
  { text: 'Genesis chapter one verse one through chapter two verse three', expect: { bookId: 'GEN', chapter: 1, verseStart: 1, endChapter: 2, verseEnd: 3 } },
  { text: 'Matthew chapter five verse three through chapter seven verse twenty nine', expect: { bookId: 'MAT', chapter: 5, verseStart: 3, endChapter: 7, verseEnd: 29 } },
  { text: 'Psalm twenty two through twenty four', expect: { bookId: 'PSA', chapter: 22, verseStart: null, endChapter: 24, verseEnd: null } },
  // same-chapter verse range still reports endChapter === chapter
  { text: 'John three sixteen to eighteen', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, endChapter: 3, verseEnd: 18 } },
  // cross-chapter endpoint validation: end chapter out of range / backwards -> discard
  { text: 'Matthew chapters five through ninety', expect: null }, // Matthew has 28 chapters
  { text: 'Psalm twenty four through twenty two', expect: null }, // backwards

  // --- validation: out-of-bounds must be discarded ---
  { text: 'Psalm 23 verse 9', expect: null }, // Psalm 23 has 6 verses
  { text: 'John 3 99', expect: null }, // John 3 has 36 verses
  { text: 'Genesis 100', expect: null }, // Genesis has 50 chapters; no valid ch:verse split either
  { text: 'Matthew 700', expect: null }, // no split of 700 is a real Matthew reference

  // --- structure-aware recovery: a joined number that can't be a chapter is
  // re-read as chapter:verse using the known structure ("Matthew 77" -> 7:7) ---
  { text: 'Matthew 77', expect: { bookId: 'MAT', chapter: 7, verseStart: 7, verseEnd: null } },
  { text: 'John 316', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'Romans 828', expect: { bookId: 'ROM', chapter: 8, verseStart: 28, verseEnd: null } },
  { text: 'Psalm 234', expect: { bookId: 'PSA', chapter: 23, verseStart: 4, verseEnd: null } },
  { text: 'Revelation 23', expect: { bookId: 'REV', chapter: 2, verseStart: 3, verseEnd: null } }, // 23 chapters don't exist -> 2:3

  // --- negatives: must not match ---
  { text: 'we walked three miles that day', expect: null },
  { text: 'this next chapter of my life', expect: null },
  { text: 'three sixteen', expect: null }, // bare numbers, no book
  { text: 'chapter three verse five', expect: null }, // no book
  { text: 'look at the numbers on the screen', expect: null }, // "numbers" with no following number
  { text: 'let us turn to the word of god', expect: null },
  { text: 'and it came to pass', expect: null }
]

// Tamil fixtures (ta-IN emits Tamil script). Book names come from tam_irv.
export const TAMIL_FIXTURES = [
  { text: 'யோவான் 3 16', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } },
  { text: 'சங்கீதங்கள் 23', expect: { bookId: 'PSA', chapter: 23, verseStart: null, verseEnd: null } },
  { text: 'மத்தேயு 5 9', expect: { bookId: 'MAT', chapter: 5, verseStart: 9, verseEnd: null } },
  { text: 'ரோமர் 8 28', expect: { bookId: 'ROM', chapter: 8, verseStart: 28, verseEnd: null } },
  { text: 'யோவான் ௩ ௧௬', expect: { bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null } }, // Tamil digits
  // Common spoken variants not in the bundled index's canonical names:
  { text: 'சங்கீதம் 91 4', expect: { bookId: 'PSA', chapter: 91, verseStart: 4, verseEnd: null } }, // singular "Psalm"
  { text: 'சங்கீதம் 91 4 மற்றும் 5', expect: { bookId: 'PSA', chapter: 91, verseStart: 4, verseEnd: 5 } }, // Tamil "and"
  { text: 'சங்கீதம் 91 4 வரை 6', expect: { bookId: 'PSA', chapter: 91, verseStart: 4, verseEnd: 6 } }, // Tamil "to"
  { text: 'வெளிப்பாடு 22 21', expect: { bookId: 'REV', chapter: 22, verseStart: 21, verseEnd: null } },
  { text: 'அப்போஸ்தலர் 2 38', expect: { bookId: 'ACT', chapter: 2, verseStart: 38, verseEnd: null } },
  { text: 'நாங்கள் நடந்தோம்', expect: null } // no reference
]
