# RachelHaydenWordle

A two-player Wordle duel. Each player secretly picks a word for the other, then you race to crack it.

- **One link, endless rematches.** Share the room link once; "Play again" resets the round in the same room and keeps the score.
- **Shared guesses, personal colours.** You see both players' guesses, and every letter is coloured against *your* target word, so your opponent's guesses reveal clues to you (and the on-screen keyboard uses them too).
- **Word list.** Valid words come from the public Wordle lists (`public/words.txt`, 14,855 words; `public/answers.txt` is the original 2,309 answers used for "Surprise me"). Build a personal list of words to use later; only valid words are accepted. Your name and list live in browser storage.
- **Timer** defaults to 120 seconds (60 / 90 / 120 / 180 / 300 / none), set in the lobby.

## Rules
Both players have 6 guesses. First to crack the other's word wins the round. If the timer runs out, or both run out of guesses, it's a draw.

## Run
```
npm install
npm start      # http://localhost:3000
npm test
```

Server is Node + Express + `ws` with in-memory rooms (the secret word never leaves the server until the round ends). Deployed on Railway; the start command and health check are in `railway.json`.

## How a game flows (v2)
- A **game** is one pair of secret words. It is played in **rounds**.
- Each round both players lock in one guess. Guesses stay hidden until both are locked in, then both flip together and the round clock restarts. The clock is **per round** (default 120s; 60/90/120/180/300/none).
- If your clock runs out, a valid word on your board is locked in automatically; otherwise you skip that round. If neither player locks in, the clock just starts again.
- Rounds are unlimited. First to crack the other's word wins; cracking each other's word in the same round is a draw.
- Words you lock in are remembered in a browser **history**; the saved **word list** is optional and only holds valid words. Saved words show as a scrollable row under "Lock it in"; the dice button picks a random word.
- The word you set for your opponent sits under their board. The eye button hides it so you can show your screen without giving it away.

## Play the computer
The home page has a "Play the computer" button. It opens a room with a built-in bot ("Claude Bot") already seated. The bot picks its own word, locks in a guess every round, accepts rematches, and plays only from what its seat can see: the colours of every revealed guess against the word it is trying to guess.
