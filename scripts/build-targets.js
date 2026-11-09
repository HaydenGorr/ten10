'use strict';
// Builds public/targets.txt: the words that may be chosen as a SECRET word.
// public/words.txt stays the (much larger) list of words that may be GUESSED,
// like the real game's allowed-guesses vs answers split.
//
// Rule: a word is a target if it is a known answer, OR it does not end in "s",
// OR it ends in "ss", OR it is on the small singular allowlist below.
// Anything else ending in a single "s" is treated as a plural (or verb form).
// Suffix tricks (us/is/os/as) don't work: in the valid list those endings are
// overwhelmingly plurals of obscure words ("tabus", "minis", "halos").
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);

const SINGULAR_S = ['alias', 'atlas', 'bias', 'kudos', 'lapis', 'lotus', 'genus', 'oasis', 'basis', 'torus', 'rebus', 'mucus', 'fetus', 'sinus', 'bogus', 'texas'];

const valid = read('words.txt');
const answers = new Set(read('answers.txt'));
const allow = new Set(SINGULAR_S.filter((w) => valid.includes(w)));
const targets = valid.filter((w) => answers.has(w) || allow.has(w) || !w.endsWith('s') || w.endsWith('ss'));
fs.writeFileSync(path.join(dir, 'targets.txt'), targets.join('\n') + '\n');
console.log(`targets: ${targets.length} of ${valid.length} valid words (${valid.length - targets.length} excluded as plurals)`);
