const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Umgebungsvariablen prüfen
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;   
const FILE_PATH = "daten/anwesenheit.json"; 

console.log("--- Server Start ---");
console.log("Repo:", GITHUB_REPO ? GITHUB_REPO : "NICHT GESETZT");
console.log("Token:", GITHUB_TOKEN ? "GESETZT (***)" : "NICHT GESETZT");

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// Cache
let memoryCache = { attendance: {} };
let lastSha = null;

// Helper: GitHub API
async function fetchFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const response = await axios.get(url, {
            headers: { 
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json"
            }
        });
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return { data: JSON.parse(content), sha: response.data.sha };
    } catch (error) {
        console.error("GitHub Ladefehler:", error.response?.status, error.response?.data?.message);
        return null;
    }
}

// Initial Laden
fetchFromGitHub().then(res => {
    if (res) {
        memoryCache = res.data;
        lastSha = res.sha;
        console.log("✅ Initialdaten von GitHub geladen.");
    } else {
        console.log("⚠️ Konnte nicht von GitHub laden (oder Datei fehlt). Starte leer.");
    }
});

app.get('/api/attendance/:date/:period', async (req, res) => {
    // Versuche Update beim Lesen, falls Cache alt
    if (!lastSha) {
        const resGH = await fetchFromGitHub();
        if (resGH) { memoryCache = resGH.data; lastSha = resGH.sha; }
    }
    const { date, period } = req.params;
    const key = `${date}_${period}`;
    res.json(memoryCache.attendance[key] || []);
});

app.post('/api/attendance', async (req, res) => {
    const { date, period, list } = req.body;
    
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        return res.status(500).json({ error: "Server Konfiguration fehlt (GITHUB_TOKEN/REPO)" });
    }

    try {
        // 1. Neueste SHA holen (wichtig für Git Konflikte)
        const refresh = await fetchFromGitHub();
        if (refresh) {
            memoryCache = refresh.data;
            lastSha = refresh.sha;
        }

        // 2. Daten updaten
        const key = `${date}_${period}`;
        if (!memoryCache.attendance) memoryCache.attendance = {};
        memoryCache.attendance[key] = list;

        // 3. Push zu GitHub
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const contentBase64 = Buffer.from(JSON.stringify(memoryCache, null, 2)).toString('base64');
        
        const body = {
            message: `Update ${date} P${period}`,
            content: contentBase64,
            sha: lastSha 
        };

        const ghRes = await axios.put(url, body, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });

        // Neue SHA merken
        lastSha = ghRes.data.content.sha;
        console.log(`✅ Gespeichert: ${date} P${period}`);
        
        res.json({ success: true });

    } catch (error) {
        console.error("Speicherfehler:", error.response?.data?.message || error.message);
        res.status(500).json({ 
            error: "GitHub Fehler: " + (error.response?.data?.message || error.message) 
        });
    }
});

// Matrix Export (nutzt Memory Cache)
app.post('/api/matrix', (req, res) => {
    const { weekDates } = req.body;
    const db = memoryCache || { attendance: {} };
    const studentMap = new Map(); 

    if (weekDates && Array.isArray(weekDates)) {
        weekDates.forEach((date, dayIndex) => {
            for (let p = 1; p <= 8; p++) {
                const key = `${date}_${p}`;
                const list = db.attendance[key] || [];
                list.forEach(student => {
                    if (!studentMap.has(student.name)) {
                        studentMap.set(student.name, { name: student.name, slots: {} });
                    }
                    studentMap.get(student.name).slots[`${dayIndex}_${p}`] = student.present;
                });
            }
        });
    }
    const matrix = Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json(matrix);
});

app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));


