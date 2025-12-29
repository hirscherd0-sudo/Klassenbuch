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

console.log("------------------------------------------");
console.log("SERVER START DIAGNOSE:");
console.log("Repo gesetzt:", GITHUB_REPO ? "JA (" + GITHUB_REPO + ")" : "NEIN");
console.log("Token gesetzt:", GITHUB_TOKEN ? "JA (Länge: " + GITHUB_TOKEN.length + ")" : "NEIN");
console.log("------------------------------------------");

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

let memoryCache = { attendance: {} };
let lastSha = null;

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
        console.error("GitHub Fetch Fehler:", error.response?.status);
        return null;
    }
}

// Initialer Check beim Start
fetchFromGitHub().then(res => {
    if (res) {
        memoryCache = res.data;
        lastSha = res.sha;
        console.log("✅ VERBINDUNG OK: Daten geladen.");
    } else {
        console.log("⚠️ WARNUNG: Konnte GitHub nicht erreichen oder Datei existiert nicht.");
    }
});

app.get('/api/attendance/:date/:period', async (req, res) => {
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
    
    // 1. Diagnose: Fehlen Variablen?
    if (!GITHUB_TOKEN) return res.status(500).json({ error: "Fehler: 'GITHUB_TOKEN' fehlt in den Environment Variables." });
    if (!GITHUB_REPO) return res.status(500).json({ error: "Fehler: 'GITHUB_REPO' fehlt in den Environment Variables." });

    try {
        // Refresh SHA
        const refresh = await fetchFromGitHub();
        if (refresh) {
            memoryCache = refresh.data;
            lastSha = refresh.sha;
        }

        // Update Memory
        const key = `${date}_${period}`;
        if (!memoryCache.attendance) memoryCache.attendance = {};
        memoryCache.attendance[key] = list;

        // GitHub Push
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

        lastSha = ghRes.data.content.sha;
        console.log(`✅ Gespeichert: ${date} P${period}`);
        
        res.json({ success: true });

    } catch (error) {
        // DETAILLIERTE FEHLERANALYSE
        let msg = "Unbekannter Fehler";
        let status = 500;

        if (error.response) {
            status = error.response.status;
            const ghMsg = error.response.data?.message;
            
            if (status === 401) msg = "401 Unauthorized: Der Token ist falsch oder abgelaufen.";
            else if (status === 404) msg = "404 Not Found: Repo-Name falsch oder Token hat keine Rechte für private Repos.";
            else if (status === 409) msg = "409 Conflict: Daten-Konflikt. Bitte Seite neu laden.";
            else msg = `GitHub API Fehler (${status}): ${ghMsg}`;
        } else {
            msg = error.message;
        }

        console.error("SPEICHER FEHLER:", msg);
        res.status(status).json({ error: msg });
    }
});

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


