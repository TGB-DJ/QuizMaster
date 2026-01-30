# QuizMaster Pro - Ultimate Online Quiz

A next-generation, offline-capable, and gamified quiz application.

## 🌟 Top Features
- **Gamification Stack**:
    - **Streak Multiplier**: Consecutive correct answers boost your score (x1.1, x1.2...).
    - **Lifelines**: 
        - `50/50`: Removes 2 wrong answers.
        - `Freeze`: Stops the timer for 10 seconds.
        - `Skip`: Move to next question without penalty (but no points).
    - **Global Leaderboard**: Save your high scores locally and beat your best.
- **Audio Experience**: 
    - Full procedural audio (no assets needed!).
    - Satisfying sound effects for clicks, correct answers, and victory.
- **Visuals**:
    - **Chart.js Integration**: Visual breakdown of your performance.
    - **Confetti**: Celebrations for high scores.
    - **Glassmorphism UI**: Premium frosted glass aesthetic.
- **PWA Ready**: Install this app on your phone (Android/iOS) and play offline!

## 🚀 Deployment (Netlify)

This project includes a `netlify.toml` for zero-config deployment.

1.  **Drag & Drop**: Simply drag this folder into Netlify Drop.
    - OR -
2.  **Git Push**: Push to GitHub and connect to Netlify.

## 🛠️ Tech Stack
- **Core**: HTML5, CSS3, Vanilla JS (ES6+)
- **libs**: `Chart.js` (Stats), `Canvas-Confetti` (Visuals)
- **APIs**: OpenTriviaDB, Web Audio API, LocalStorage
