'use strict';
const fs = require('fs');
const path = require('path');

function loadList(file) {
  return fs
    .readFileSync(path.join(__dirname, '..', 'public', file), 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{5}$/.test(w));
}

const WORDS = new Set(loadList('words.txt'));
const ANSWERS = loadList('answers.txt');

const isValidWord = (w) => typeof w === 'string' && WORDS.has(w.toLowerCase());

/**
 * Standard Wordle scoring (handles duplicate letters correctly).
 * Returns a 5-char string: c = correct (green), p = present (yellow), a = absent.
 */
function evaluate(guess, target) {
  const res = ['a', 'a', 'a', 'a', 'a'];
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) res[i] = 'c';
    else left[target[i]] = (left[target[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'c') continue;
    if (left[guess[i]] > 0) {
      res[i] = 'p';
      left[guess[i]]--;
    }
  }
  return res.join('');
}

module.exports = { WORDS, ANSWERS, isValidWord, evaluate };
