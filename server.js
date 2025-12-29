const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Dient die index.html aus dem 'public' Ordner

// Hilfsfunktion: Datenbank laden
const loadDatabase = () => {
    if (!fs.existsSync(DB_FILE)) {
        return { attendance: {} }; // Initiale leere DB
    }
    const data = fs.readFileSync(DB_FILE);
    return JSON.parse(data);
};

// Hilfsfunktion: Datenbank speichern
const saveDatabase = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// API: Daten für einen bestimmten Tag und Stunde holen
app.get('/api/attendance/:date/:period', (req, res) => {
    const { date, period } = req.params;
    const db = loadDatabase();
    
    // Key Format: "2023-10-27_1" (Datum_Stunde)
    const key = `${date}_${period}`;
    const list = db.attendance[key] || [];
    
    res.json(list);
});

// API: Liste speichern
app.post('/api/attendance', (req, res) => {
    const { date, period, list } = req.body;
    const db = loadDatabase();
    
    const key = `${date}_${period}`;
    db.attendance[key] = list;
    
    saveDatabase(db);
    res.json({ success: true, message: "Gespeichert" });
});

// API: Wochendaten holen (für PDF Export)
app.post('/api/weekly', (req, res) => {
    const { dates } = req.body; // Array von Datums-Strings
    const db = loadDatabase();
    const result = {};

    dates.forEach(date => {
        result[date] = {};
        for (let i = 1; i <= 8; i++) {
            const key = `${date}_${i}`;
            if (db.attendance[key]) {
                result[date][i] = db.attendance[key];
            }
        }
    });

    res.json(result);
});

// Server starten
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    console.log(`Daten werden gespeichert in: ${DB_FILE}`);
});

