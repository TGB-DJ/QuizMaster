/**
 * QuizMaster Pro - Core Logic
 * Features: Procedural Audio, Gamification, PWA, Chart.js, Firebase
 */

import {
    db, collection, addDoc, onSnapshot, query, orderBy, limit,
    where, getDocs, updateDoc, doc, serverTimestamp, setDoc, getDoc,
    auth, provider, signInWithPopup, signOut, onAuthStateChanged
} from "./firebase-config.js";


// --- CONFIGURATION & STATE ---

const CONSTANTS = {
    TIMER_BASE: 15, // seconds
    POINTS_PER_Q: 10,
    STREAK_BONUS: 5,
    API_BASE: 'https://opentdb.com/api.php'
};

const STATE = {
    questions: [],
    currIndex: 0,
    score: 0,
    streak: 0,
    timer: null,
    timeLeft: CONSTANTS.TIMER_BASE,
    config: { amount: 10, exam: 'TNPSC', difficulty: '' },
    user: 'Guest',
    lifelines: { fifty: true, freeze: true, skip: true },
    isFrozen: false,
    audioEnabled: true,
    xp: 0,
    level: 1
};

// --- LAZY LOADER ---
const loadConfetti = async () => (await import('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/+esm')).default;
const loadChart = async () => (await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/+esm')).default;

// --- PWA SERVICE WORKER REGISTRATION ---
// --- PWA SERVICE WORKER CLEANUP (Dev Mode: Force Fresh Load) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            for (let registration of registrations) {
                registration.unregister().then(() => console.log('🧹 Stale SW Unregistered'));
            }
        });
    });
}

// --- AUDIO SYSTEM (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const SOUNDS = {
    playTone: (freq, type, duration) => {
        if (!STATE.audioEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    },
    click: () => SOUNDS.playTone(600, 'sine', 0.1),
    correct: () => {
        SOUNDS.playTone(600, 'sine', 0.1);
        setTimeout(() => SOUNDS.playTone(800, 'sine', 0.2), 100);
    },
    wrong: () => {
        SOUNDS.playTone(300, 'sawtooth', 0.1);
        setTimeout(() => SOUNDS.playTone(200, 'sawtooth', 0.3), 100);
    },
    win: () => {
        [400, 500, 600, 800].forEach((f, i) => setTimeout(() => SOUNDS.playTone(f, 'square', 0.2), i * 150));
    }
};

// --- DOM ELEMENTS ---
const screens = {
    start: document.getElementById('start-screen'),
    quiz: document.getElementById('quiz-screen'),
    result: document.getElementById('result-screen'),
    review: document.getElementById('review-screen'),
    loader: document.getElementById('loader'),
    modal: document.getElementById('leaderboard-modal')
};

const ui = {
    question: document.getElementById('question-text'),
    options: document.getElementById('options-container'),
    timer: document.getElementById('time-left'),
    score: document.getElementById('current-score'),
    streak: document.getElementById('streak-count'),
    badge: document.getElementById('streak-box'),
    progress: document.getElementById('progress-bar'),
    qCurrent: document.getElementById('current-q'),
    qTotal: document.getElementById('total-q'),
    category: document.getElementById('q-category'),
    nextBtn: document.getElementById('next-btn')
};

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initEventListeners();
    initFirestoreListeners();
    initKeyboard();
    initAntiCheat();

    // Auto-select 10 Questions by default
    const defaultBtn = document.querySelector('.amount-btn');
    if (defaultBtn) selectAmount(defaultBtn, 10);

    // initAuth is handled by firebase-config listener mostly, 
    // but checks for user state.
});

function initAuth() {
    // Login
    document.getElementById('google-login-btn').addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            showToast(`Welcome ${user.displayName}! ☁️`);
            syncCloudData(user);
        } catch (error) {
            console.error(error);
            showToast("Login Failed", true);
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        signOut(auth).then(() => {
            showToast("Logged Out");
            STATE.user = 'Guest';
            document.getElementById('auth-section').querySelector('#google-login-btn').classList.remove('hidden');
            document.getElementById('user-profile').classList.add('hidden');
        });
    });

    // Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.getElementById('google-login-btn').classList.add('hidden');
            const profile = document.getElementById('user-profile');
            profile.classList.remove('hidden');
            profile.style.display = 'flex';
            document.getElementById('user-avatar').src = user.photoURL;
            document.getElementById('user-name-display').innerText = user.displayName;

            STATE.user = user.displayName; // Update Game State

            // Auto-Fill Username input
            document.getElementById('username').value = user.displayName;
            document.getElementById('username').disabled = true; // Lock it
        }
    });
}

// --- PERSISTENCE ---
async function syncCloudData(user) {
    // Check if user has data in Firestore
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
        const data = snap.data();
        STATE.xp = data.xp || STATE.xp;
        STATE.level = data.level || STATE.level;
        showToast("Progress Synced from Cloud! 🔄");
    } else {
        // First time? Upload local stats
        saveUserData(user);
    }
}

function loadUserData() {
    const saved = localStorage.getItem('quiz_userdata');
    if (saved) {
        const data = JSON.parse(saved);
        STATE.xp = data.xp || 0;
        STATE.level = data.level || 1;
        // Don't override name if Guest, let them type
    }
}

async function saveUserData(firebaseUser = null) {
    // 1. Local Save
    localStorage.setItem('quiz_userdata', JSON.stringify({
        xp: STATE.xp,
        level: STATE.level
    }));

    // 2. Cloud Save (if logged in)
    const user = firebaseUser || auth.currentUser;
    if (user) {
        try {
            await setDoc(doc(db, "users", user.uid), {
                xp: STATE.xp,
                level: STATE.level,
                last_active: serverTimestamp(),
                name: user.displayName
            }, { merge: true });
        } catch (e) { console.error("Cloud Save Error", e); }
    }
}

function initAntiCheat() {
    // 1. Block Context Menu
    document.addEventListener('contextmenu', e => e.preventDefault());

    // 2. Tab Blur Detection
    window.addEventListener('blur', () => {
        if (screens.quiz.classList.contains('active')) {
            showToast("⚠️ Warning: Leaving the tab is considered cheating!");
            SOUNDS.wrong();
        }
    });
}


function initEventListeners() {
    // 1. Navigation & UI
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    const soundBtn = document.getElementById('sound-btn');
    if (soundBtn) soundBtn.addEventListener('click', toggleSound);

    const fullBtn = document.getElementById('fullscreen-btn');
    if (fullBtn) fullBtn.addEventListener('click', toggleFullscreen);

    const profileBtn = document.getElementById('profile-btn');
    if (profileBtn) profileBtn.addEventListener('click', handleProfileClick);

    // 2. Game Flow
    const quizConfig = document.getElementById('quiz-config');
    if (quizConfig) quizConfig.addEventListener('submit', validateAndStart);

    if (ui.nextBtn) ui.nextBtn.addEventListener('click', nextQuestion);

    // 3. Results
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', goHome);

    const homeBtn = document.getElementById('home-btn');
    if (homeBtn) homeBtn.addEventListener('click', goHome);

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.addEventListener('click', shareResults);

    const reviewBtn = document.getElementById('review-btn');
    if (reviewBtn) reviewBtn.addEventListener('click', showReview);

    const closeReviewBtn = document.getElementById('close-review-btn');
    if (closeReviewBtn) closeReviewBtn.addEventListener('click', hideReview);

    // 4. Lifelines
    const life50 = document.getElementById('lifeline-5050');
    if (life50) life50.addEventListener('click', use5050);

    const lifeFreeze = document.getElementById('lifeline-freeze');
    if (lifeFreeze) lifeFreeze.addEventListener('click', useFreeze);

    const lifeSkip = document.getElementById('lifeline-skip');
    if (lifeSkip) lifeSkip.addEventListener('click', useSkip);

    // 5. Modals
    const lbBtn = document.getElementById('show-leaderboard');
    if (lbBtn) lbBtn.addEventListener('click', () => toggleModal('leaderboard-modal', true));

    const closeLb = document.querySelector('.close-modal');
    if (closeLb) closeLb.addEventListener('click', () => toggleModal('leaderboard-modal', false));

    const rulesBtn = document.getElementById('open-rules');
    if (rulesBtn) rulesBtn.addEventListener('click', () => toggleModal('rules-modal', true));

    const closeRules = document.querySelector('.close-modal-rules');
    if (closeRules) closeRules.addEventListener('click', () => toggleModal('rules-modal', false));

    const policyBtn = document.getElementById('open-policy');
    if (policyBtn) policyBtn.addEventListener('click', () => toggleModal('policy-modal', true));

    const closePolicy = document.querySelector('.close-modal-policy');
    if (closePolicy) closePolicy.addEventListener('click', () => toggleModal('policy-modal', false));

    // 6. Auth
    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', handleGoogleLogin);
}

// --- GLOBAL HANDLERS (HTML OnClick) ---
window.toggleTheme = toggleTheme;
window.toggleSound = toggleSound;
window.toggleFullscreen = toggleFullscreen;
window.handleProfileClick = handleProfileClick;

window.selectAmount = function (btn, val) {
    // 1. Visual Reset
    document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('active'));

    // 2. Set Active
    btn.classList.add('active');

    // 3. Update State
    document.getElementById('amount').value = val;
    SOUNDS.click();
};

// --- AUTH LOGIC ---
async function handleGoogleLogin() {
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        STATE.user = user.displayName;
        showToast(`Welcome back, ${user.displayName}! 🚀`);

        // Update UI
        document.getElementById('username').value = user.displayName;
        document.getElementById('username').disabled = true; // Lock it
        document.querySelector('.username-group p').innerText = "Logged in via Google";
        document.getElementById('google-login-btn').style.display = 'none'; // Hide login button

        await loadUserData(user.uid);
    } catch (error) {
        console.error("Login Failed", error);
        showToast("Login Failed: " + error.message, true);
    }
}

// --- GAME LOGIC ---

async function validateAndStart(e) {
    if (e) e.preventDefault(); // Handle both Form Submit and Click
    SOUNDS.click();

    // 1. Validate User
    const userRaw = document.getElementById('username').value.trim();
    if (STATE.user === 'Guest' && !userRaw) {
        const input = document.getElementById('username');
        input.classList.add('shake');
        input.style.borderColor = 'var(--error)';
        setTimeout(() => input.classList.remove('shake'), 500);
        showToast("Please enter a name!", true);
        return;
    }

    if (STATE.user === 'Guest') STATE.user = userRaw.substring(0, 15);

    // 2. State & Config
    document.getElementById('user-greeting').innerText = STATE.user;

    // Validate Amount
    const amountVal = document.getElementById('amount').value;
    if (!amountVal) {
        const box = document.getElementById('amount-box');
        if (box) {
            box.classList.add('shake');
            box.style.border = "1px solid var(--error)";
            setTimeout(() => {
                box.classList.remove('shake');
                box.style.border = "none";
            }, 500);
        }
        showToast("Please select number of questions! 📊", true);
        return;
    }

    STATE.config.amount = parseInt(amountVal);
    STATE.config.exam = document.getElementById('exam-type').value;
    STATE.config.difficulty = document.getElementById('difficulty').value;

    screens.start.classList.remove('active');
    screens.loader.classList.remove('hidden');

    try {
        await fetchQuestions();
        startGame();
    } catch (err) {
        alert('Error fetching questions: ' + err.message);
        screens.loader.classList.add('hidden');
        screens.start.classList.add('active');
    }
}

async function fetchQuestions() {
    console.log(`Fetching questions for ${STATE.config.exam}...`);

    // 1. Query Firestore for this Exam Type
    const q = query(
        collection(db, "questions"),
        where("exam_tag", "==", STATE.config.exam),
        limit(100) // Fetch a batch to filter locally
    );

    const snapshot = await getDocs(q);

    let allDocs = [];

    // --- SERVERLESS AUTO-FETCH (Self-Healing) ---
    if (snapshot.empty) {
        console.log("🔥 Database Empty for this Exam! Auto-fetching...");
        showToast("First time setup... Fetching questions ⏳");

        await autoSeedQuestions(STATE.config.exam);

        // Retry Fetch
        const retrySnapshot = await getDocs(q);
        if (retrySnapshot.empty) throw new Error("API Limit Reached or Network Error.");

        retrySnapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
    } else {
        // Normal Flow
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter Logic (Simplified for performance)
            if (!data.last_used || data.last_used.toDate() < fortyEightHoursAgo) {
                allDocs.push({ id: doc.id, ...data });
            }
        });
    }

    if (allDocs.length < STATE.config.amount) {
        // If we filtered out too many (cooldown), and have 0 left, force a re-seed?
        // For now, simpler fallback: use OLD questions if absolutely necessary.
        if (allDocs.length === 0 && !snapshot.empty) {
            console.warn("Using older questions due to lack of fresh ones.");
            snapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
        }

        // If STILL 0 (Logic error possible), try auto-seed
        if (allDocs.length === 0) {
            await autoSeedQuestions(STATE.config.exam);
            const finalSnap = await getDocs(q);
            finalSnap.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
        }
    }

    // ... rest of logic checks length ...

    if (allDocs.length < STATE.config.amount) {
        console.warn("Not enough fresh questions! Repeating some.");
        // Fallback: If ran out of fresh questions, use any from the exam
        if (allDocs.length === 0 && snapshot.size > 0) {
            snapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
        }
    }

    // 3. Shuffle and Slice
    allDocs.sort(() => Math.random() - 0.5);
    const selectedDocs = allDocs.slice(0, STATE.config.amount);

    if (selectedDocs.length === 0) throw new Error("No questions available.");

    // 4. Mark as Used in Background
    selectedDocs.forEach(async (q) => {
        try {
            const ref = doc(db, "questions", q.id);
            await updateDoc(ref, { last_used: serverTimestamp() });
        } catch (e) { console.error("Error marking question used", e); }
    });

    // 5. Map to Game Format
    STATE.questions = selectedDocs.map(q => ({
        ...q,
        answers: [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5)
    }));
}

// --- AUTO SEEDER (Client Side) ---
const API_MAPPING = {
    'TNPSC': [9, 23, 22], 'RRB': [17, 18, 19], 'BANKING': [19, 18],
    'UPSC': [23, 24, 25, 22], 'JEE': [17, 19], 'NEET': [17],
    'GATE': [18, 19], 'CAT': [19, 9], 'CA': [19, 24],
    'CLAT': [24, 23], 'NDA': [22, 23], 'NID': [25, 24], 'UGC-NET': [9, 23]
};

async function autoSeedQuestions(exam) {
    const categories = API_MAPPING[exam] || [9]; // Default GK
    // Fetch 15 questions to be safe
    const amount = 15;
    let added = 0;

    // Try each category until we get enough
    for (const catId of categories) {
        if (added >= amount) break;
        try {
            const res = await fetch(`https://opentdb.com/api.php?amount=${amount}&category=${catId}&type=multiple`);
            const data = await res.json();

            if (data.results) {
                const batchPromises = data.results.map(q =>
                    addDoc(collection(db, "questions"), {
                        question: q.question,
                        correct_answer: q.correct_answer,
                        incorrect_answers: q.incorrect_answers,
                        category: q.category,
                        difficulty: q.difficulty,
                        exam_tag: exam,
                        created_at: new Date(),
                        last_used: null
                    })
                );
                await Promise.all(batchPromises);
                added += data.results.length;
            }
        } catch (e) {
            console.error("Auto-seed failed for cat " + catId, e);
        }
    }
}

function startGame() {
    // Reset State
    STATE.currIndex = 0;
    STATE.score = 0;
    STATE.streak = 0;
    STATE.lifelines = { fifty: true, freeze: true, skip: true };
    STATE.isFrozen = false;

    // Reset UI
    resetLifelines();
    updateStats();

    screens.loader.classList.add('hidden');
    screens.quiz.classList.remove('hidden');
    screens.quiz.classList.add('active');

    renderQuestion();
}

function renderQuestion() {
    const q = STATE.questions[STATE.currIndex];

    // Text
    ui.question.innerHTML = q.question;
    ui.category.innerText = q.category;
    ui.qCurrent.innerText = STATE.currIndex + 1;
    ui.qTotal = STATE.questions.length;

    // Progress
    const pct = ((STATE.currIndex) / STATE.questions.length) * 100;
    ui.progress.style.width = `${pct}%`;

    // Options
    ui.options.innerHTML = '';
    q.answers.forEach(ans => {
        const btn = document.createElement('div');
        btn.className = 'option-card';
        btn.innerHTML = ans;
        btn.onclick = () => handleAnswer(btn, ans, q.correct_answer);
        ui.options.appendChild(btn);
    });

    // Timer
    STATE.timeLeft = CONSTANTS.TIMER_BASE;
    STATE.isFrozen = false;
    startTimer();

    // Audio tone
    if (STATE.audioEnabled && audioCtx.state === 'suspended') audioCtx.resume();
}

function startTimer() {
    clearInterval(STATE.timer);
    ui.timer.parentElement.classList.remove('danger');

    STATE.timer = setInterval(() => {
        if (STATE.isFrozen) return;

        STATE.timeLeft--;
        ui.timer.innerText = STATE.timeLeft;

        if (STATE.timeLeft <= 5) ui.timer.parentElement.classList.add('danger');

        if (STATE.timeLeft <= 0) {
            clearInterval(STATE.timer);
            handleTimeOut();
        }
    }, 1000);
}

function handleAnswer(btn, selected, correct) {
    if (ui.nextBtn.disabled === false) return; // Prevent double click
    clearInterval(STATE.timer);

    const isCorrect = selected === correct;
    const cards = document.querySelectorAll('.option-card');

    // Save User Choice for Review
    STATE.questions[STATE.currIndex].userSelected = selected;

    if (isCorrect) {
        btn.classList.add('correct');
        SOUNDS.correct();

        // Score Logic
        const timeBonus = Math.max(0, STATE.timeLeft);
        const streakMult = 1 + (Math.floor(STATE.streak / 3) * 0.1); // +10% every 3 streak
        const points = Math.round((CONSTANTS.POINTS_PER_Q + timeBonus) * streakMult);

        STATE.score += points;
        STATE.streak++;

        if (STATE.streak > 2) triggerConfetti();
        addXP(points);
    } else {
        btn.classList.add('wrong');
        cards.forEach(c => { if (c.innerHTML === correct) c.classList.add('correct'); });
        SOUNDS.wrong();
        STATE.streak = 0;
        showToast("Oops! Incorrect.", true);
    }

    // Animation Delay before next
    setTimeout(() => {
        updateStats();
        cards.forEach(c => { c.onclick = null; c.style.cursor = 'default'; });
        ui.nextBtn.disabled = false;
    }, 800);
}

function addXP(amount) {
    STATE.xp += amount;
    const nextLevel = Math.floor(STATE.xp / 100) + 1;
    if (nextLevel > STATE.level) {
        STATE.level = nextLevel;
        SOUNDS.win();
        showToast(`🎉 Level Up! You are now Level ${STATE.level}`);
        showToast(`🎉 Level Up! You are now Level ${STATE.level}`);
    }
    saveUserData(); // Auto-save after every XP gain
}

function showToast(msg, isError = false) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.borderLeftColor = isError ? 'var(--error)' : 'var(--accent)';
    el.innerText = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function handleTimeOut() {
    const q = STATE.questions[STATE.currIndex];
    const cards = document.querySelectorAll('.option-card');

    // Save as null/timeout
    q.userSelected = null;

    cards.forEach(c => {
        if (c.innerHTML === q.correct_answer) c.classList.add('correct');
        c.onclick = null;
    });
    SOUNDS.wrong();
    STATE.streak = 0;
    updateStats();
    ui.nextBtn.disabled = false;
}

function nextQuestion() {
    STATE.currIndex++;
    ui.nextBtn.disabled = true;
    SOUNDS.click();

    if (STATE.currIndex < STATE.questions.length) {
        renderQuestion();
    } else {
        endGame();
    }
}

// --- LIFELINES ---

function use5050() {
    if (!STATE.lifelines.fifty) return;
    const q = STATE.questions[STATE.currIndex];
    const cards = Array.from(document.querySelectorAll('.option-card'));
    const wrongCards = cards.filter(c => c.innerHTML !== q.correct_answer);

    // Hide 2 wrong
    for (let i = 0; i < 2; i++) {
        if (wrongCards[i]) wrongCards[i].style.visibility = 'hidden';
    }

    disableLifeline('lifeline-5050');
    STATE.lifelines.fifty = false;
}

function useFreeze() {
    if (!STATE.lifelines.freeze) return;
    STATE.isFrozen = true;
    disableLifeline('lifeline-freeze');
    STATE.lifelines.freeze = false;

    // Unfreeze after 10s or next Turn (handled by renderQuestion reset)
    setTimeout(() => { STATE.isFrozen = false; }, 10000);
}

function useSkip() {
    if (!STATE.lifelines.skip) return;
    disableLifeline('lifeline-skip');
    STATE.lifelines.skip = false;

    // Grant base points and move on
    STATE.score += CONSTANTS.POINTS_PER_Q;
    clearInterval(STATE.timer);
    nextQuestion();
}

function disableLifeline(id) {
    const btn = document.getElementById(id);
    btn.disabled = true;
    btn.style.opacity = 0.5;
    SOUNDS.playTone(200, 'triangle', 0.1);
}

function resetLifelines() {
    ['lifeline-5050', 'lifeline-freeze', 'lifeline-skip'].forEach(id => {
        const btn = document.getElementById(id);
        btn.disabled = false;
        btn.style.opacity = 1;
    });
}

// --- END GAME & STATS ---

function endGame() {
    screens.quiz.classList.remove('active');
    screens.quiz.classList.add('hidden');
    screens.result.classList.remove('hidden');

    SOUNDS.win();

    // Lazy Load Confetti
    loadConfetti().then(confetti => {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    });

    // Update Stats
    document.getElementById('final-score').innerText = STATE.score;

    const correct = STATE.score > 0 ? Math.floor(STATE.score / 15) : 0; // Estimation for demo
    // Actually let's count properly: We need to track correct count in STATE usually, but for now:
    // Let's assume Max Possible Score per Q is approx 25. 
    // Simplified for UI:
    const acc = Math.round((STATE.score / (STATE.questions.length * 25)) * 100);

    document.querySelector('.final-message').innerText =
        acc > 80 ? "Quiz Master!" : acc > 50 ? "Good Job!" : "Keep Practicing!";

    saveHighScore();
    renderChart();
}

function updateStats() {
    ui.score.innerText = STATE.score;
    ui.streak.innerText = STATE.streak;
    ui.badge.classList.toggle('hidden', STATE.streak < 2);
}

async function triggerConfetti() {
    const confetti = await loadConfetti();
    confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#6C63FF', '#F4D03F']
    });
}

// --- LEADERBOARD & PERSISTENCE ---

// --- LEADERBOARD & PERSISTENCE (FIREBASE) ---

async function saveHighScore() {
    if (!STATE.user || STATE.score === undefined) return;

    try {
        await addDoc(collection(db, "leaderboard"), {
            name: STATE.user,
            score: Number(STATE.score),
            xp: STATE.xp,
            verified: !!auth.currentUser,
            uid: auth.currentUser ? auth.currentUser.uid : null, // Save UID for Admin deletion
            date: new Date().toISOString()
        });
        console.log("Score saved to Firebase!");
    } catch (e) {
        console.error("Error adding score: ", e);
    }
}

let unsubscribe = null;

// (Old initFirestoreListeners removed - duplicated at bottom)

function handleProfileClick() {
    if (auth.currentUser) {
        // Populate Modal
        document.getElementById('profile-name-large').innerText = STATE.user;
        document.getElementById('profile-level').innerText = STATE.level;
        document.getElementById('profile-xp').innerText = STATE.xp;

        const img = document.getElementById('profile-img-large');
        const init = document.getElementById('profile-initial');

        if (auth.currentUser.photoURL) {
            img.src = auth.currentUser.photoURL;
            img.style.display = 'block';
            init.style.display = 'none';
        } else {
            img.style.display = 'none';
            init.style.display = 'flex';
            init.innerText = STATE.user.charAt(0).toUpperCase();
        }

        toggleModal('profile-modal', true);
    } else {
        // User is Guest
        showToast("Please Sign In to save progress! ☁️");
        const btn = document.getElementById('google-login-btn');
        if (btn) {
            btn.classList.add('pulse');
            setTimeout(() => btn.classList.remove('pulse'), 1000);
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Ensure global access for onclick
window.handleProfileClick = handleProfileClick;

window.signOut = function () {
    auth.signOut().then(() => {
        window.location.reload();
    });
};

function toggleModal(id, show) {
    const el = document.getElementById(id); // Use ID passed
    if (el) el.classList.toggle('hidden', !show);
}

// --- REVIEW MODE ---

function showReview() {
    const list = document.getElementById('review-list');
    list.innerHTML = '';

    STATE.questions.forEach((q, i) => {
        const item = document.createElement('div');
        item.classList.add('review-item');

        let optionsHtml = '';
        q.answers.forEach(ans => {
            let className = 'review-opt';
            // Logic:
            // 1. If this was Correct Answer -> Green
            // 2. If User Picked this AND it was Wrong -> Red
            // 3. (Optional) If User Picked this AND Correct -> handled by 1? No.

            if (ans === q.correct_answer) {
                className += ' r-correct';
                if (ans === q.userSelected) className += ' r-picked-correct';
            } else if (ans === q.userSelected) {
                className += ' r-wrong';
            }

            optionsHtml += `<div class="${className}">${ans}</div>`;
        });

        item.innerHTML = `
                <h3>${i + 1}. ${q.question}</h3>
                <div class="review-options">
                    ${optionsHtml}
                </div>
            `;
        list.appendChild(item);
    });

    screens.result.classList.add('hidden');
    screens.result.classList.remove('active');
    screens.review.classList.remove('hidden');
    screens.review.classList.add('active');
}

function hideReview() {
    screens.review.classList.add('hidden');
    screens.review.classList.remove('active');
    screens.result.classList.remove('hidden');
    screens.result.classList.add('active');
}

// --- UTILS ---

function initKeyboard() {
    document.addEventListener('keydown', (e) => {
        // Shortcuts only work in Quiz Screen
        if (!screens.quiz.classList.contains('active')) return;

        // Options 1-4
        if (['1', '2', '3', '4'].includes(e.key)) {
            const index = parseInt(e.key) - 1;
            const options = document.querySelectorAll('.option-card');
            if (options[index]) options[index].click();
        }

        // Next Question -> Enter or Space
        if ((e.key === 'Enter' || e.key === ' ') && !ui.nextBtn.disabled) {
            ui.nextBtn.click();
        }
    });
}

let scoreChart = null;

async function renderChart() {
    const ctx = document.getElementById('scoreChart').getContext('2d');
    if (scoreChart) scoreChart.destroy();

    const Chart = await loadChart();

    scoreChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Score', 'Potential'],
            datasets: [{
                data: [STATE.score, (STATE.questions.length * 25) - STATE.score],
                backgroundColor: ['#6C63FF', '#2A2D3E'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            cutout: '70%',
            plugins: { legend: { display: false } }
        }
    });
}

function toggleTheme() {
    const body = document.documentElement;
    const isDark = body.getAttribute('data-theme') === 'dark';
    body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('theme-toggle').querySelector('i').className =
        isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

function toggleSound() {
    STATE.audioEnabled = !STATE.audioEnabled;
    document.getElementById('sound-btn').querySelector('i').className =
        STATE.audioEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
}

// --- HELPER FUNCTIONS ---

function goHome() {
    stateReset();
    screens.review.classList.add('hidden');
    screens.review.classList.remove('active');

    screens.result.classList.add('hidden');
    screens.result.classList.remove('active');

    screens.start.classList.add('active');
    screens.start.classList.remove('hidden');
}

function shareResults() {
    const text = `I just scored ${STATE.score} on QuizMaster! Can you beat me ? `;
    if (navigator.share) {
        navigator.share({
            title: 'QuizMaster Pro',
            text: text,
            url: window.location.href
        });
    } else {
        const waUrl = `https://wa.me/?text=${encodeURIComponent(text + " " + window.location.href)}`;
        window.open(waUrl, '_blank');
    }
}

function stateReset() {
    STATE.score = 0;
    STATE.currentQuestionIndex = 0;
    STATE.questions = [];
}

function loadSettings() {
    // Restore basic settings if needed
}

// --- FIRESTORE LISTENERS ---
function initFirestoreListeners() {
    // Leaderboard
    const q = query(collection(db, "users"), orderBy("score", "desc"), limit(10));
    onSnapshot(q, (snapshot) => {
        // MATCH INDEX.HTML ID
        const list = document.getElementById('high-score-list');
        if (!list) return;

        list.innerHTML = '';
        snapshot.docs.forEach((doc, i) => {
            const entry = doc.data();
            let rankClass = '';
            let icon = '';

            if (i === 0) { rankClass = 'rank-1'; icon = '👑'; }
            else if (i === 1) { rankClass = 'rank-2'; icon = '🥈'; }
            else if (i === 2) { rankClass = 'rank-3'; icon = '🥉'; }

            const badge = entry.verified ? '<i class="fa-solid fa-circle-check" style="color:#1DA1F2; margin-left:10px;"></i>' : '';

            const row = document.createElement('div');
            row.classList.add('highscore-entry', rankClass);
            row.innerHTML = `
                <span class="rank">#${i + 1}</span>
                <span class="name">${icon} ${entry.name || 'Anonymous'} ${badge}</span>
                <span class="score">${entry.score} pts</span>
            `;
            list.appendChild(row);
        });
    });
}

// Export global for HTML access (onclick="startGame()")
window.startGame = startGame;
window.stateReset = stateReset;
window.goHome = goHome;
window.shareResults = shareResults;
window.selectAmount = selectAmount;
window.toggleModal = toggleModal; // Fix for Close Buttons

console.log("🚀 QuizMaster Script Loaded & Ready");
