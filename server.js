const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Konfiguration aus Umgebungsvariablen
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // z.B. "ghp_xxxxxxxxxxxx"
const GITHUB_REPO = process.env.GITHUB_REPO;   // z.B. "username/repo"
const FILE_PATH = "daten/anwesenheit.json";    // Pfad im Repo

if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("ACHTUNG: GITHUB_TOKEN oder GITHUB_REPO nicht gesetzt! Speichern wird nicht funktionieren.");
}

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- GitHub API Helper ---

// 1. Daten von GitHub holen
async function fetchFromGitHub() {
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json"
            }
        });
        
        // GitHub sendet Content als base64
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return {
            data: JSON.parse(content),
            sha: response.data.sha // Wichtig für Updates
        };
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // Datei existiert noch nicht
            return { data: { attendance: {} }, sha: null };
        }
        console.error("GitHub Fetch Error:", error.message);
        throw error;
    }
}

// 2. Daten zu GitHub pushen (Commit)
async function saveToGitHub(newData, sha) {
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
        const contentBase64 = Buffer.from(JSON.stringify(newData, null, 2)).toString('base64');
        
        const body = {
            message: "Update Anwesenheitsliste via App", // Commit Nachricht
            content: contentBase64,
            sha: sha // Falls sha null ist, wird Datei erstellt
        };

        await axios.put(url, body, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json"
            }
        });
        console.log("✅ Erfolgreich auf GitHub gespeichert.");
    } catch (error) {
        console.error("GitHub Save Error:", error.response ? error.response.data : error.message);
        throw error;
    }
}

// --- API Endpoints ---

// Cache für Performance (damit wir nicht bei jedem Klick GitHub fragen müssen)
let memoryCache = null;
let lastSha = null;

// Initial Laden beim Serverstart
fetchFromGitHub().then(res => {
    memoryCache = res.data;
    lastSha = res.sha;
    console.log("Initialdaten geladen.");
}).catch(() => {
    memoryCache = { attendance: {} };
    console.log("Starte mit leerer DB.");
});

// 1. Lesen
app.get('/api/attendance/:date/:period', async (req, res) => {
    // Wenn Cache leer, versuche zu laden
    if (!memoryCache) {
        try {
            const resGH = await fetchFromGitHub();
            memoryCache = resGH.data;
            lastSha = resGH.sha;
        } catch (e) {
            memoryCache = { attendance: {} };
        }
    }

    const { date, period } = req.params;
    const key = `${date}_${period}`;
    res.json(memoryCache.attendance[key] || []);
});

// 2. Schreiben (Mit GitHub Sync)
app.post('/api/attendance', async (req, res) => {
    try {
        const { date, period, list } = req.body;
        
        // Zuerst sicherstellen, dass wir die neuste SHA haben
        // (In einer echten App müssten wir hier locken, aber für Klassenbuch ok)
        try {
            const refresh = await fetchFromGitHub();
            memoryCache = refresh.data;
            lastSha = refresh.sha;
        } catch (e) { /* Datei existiert evtl noch nicht */ }

        // Update im Speicher
        const key = `${date}_${period}`;
        if (!memoryCache.attendance) memoryCache.attendance = {};
        memoryCache.attendance[key] = list;

        // Push zu GitHub
        await saveToGitHub(memoryCache, lastSha);
        
        // Neue SHA holen für nächsten Save (wird eigentlich vom PUT returned, aber wir refreshen beim nächsten mal)
        res.json({ success: true });

    } catch (error) {
        res.status(500).json({ error: "Fehler beim GitHub Sync" });
    }
});

// 3. Matrix Export
app.post('/api/matrix', (req, res) => {
    // Nutzt den Memory Cache, geht also super schnell
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

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});


