const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3080;
const DATA_FILE = path.join(__dirname, 'data', 'trips.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Setup
const MONGODB_URI = process.env.MONGODB_URI;
let dbClient = null;
let dbCollection = null;

async function initMongoDB() {
  if (!MONGODB_URI) {
    console.log('No MONGODB_URI provided. Using local trips.json for storage.');
    return;
  }
  try {
    dbClient = new MongoClient(MONGODB_URI);
    await dbClient.connect();
    const db = dbClient.db('travel_calendar');
    dbCollection = db.collection('trips');
    console.log('Connected to MongoDB Atlas');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
  }
}

// Local JSON Helpers
async function readLocalDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      if (!fs.existsSync(path.dirname(DATA_FILE))) {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading local database:', err);
    return [];
  }
}

async function writeLocalDB(data) {
  try {
    if (!fs.existsSync(path.dirname(DATA_FILE))) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing local database:', err);
    return false;
  }
}

// API: Get all trips
app.get('/api/trips', async (req, res) => {
  if (dbCollection) {
    try {
      const trips = await dbCollection.find({}).toArray();
      res.json(trips);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  } else {
    const db = await readLocalDB();
    res.json(db);
  }
});

// API: Get single trip details
app.get('/api/trips/:id', async (req, res) => {
  if (dbCollection) {
    try {
      const trip = await dbCollection.findOne({ id: req.params.id });
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      res.json(trip);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  } else {
    const db = await readLocalDB();
    const trip = db.find(t => t.id === req.params.id);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    res.json(trip);
  }
});

// API: Create new trip
app.post('/api/trips', async (req, res) => {
  const { name, startDate, endDate, coverImage, desc, totalBudget, city } = req.body;
  if (!name || !startDate || !endDate) {
    return res.status(400).json({ error: 'Name, start date, and end date are required' });
  }

  // Parse dates to calculate number of days
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  const days = [];
  for (let i = 1; i <= diffDays; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + (i - 1));
    days.push({
      dayNum: i,
      date: currentDate.toISOString().split('T')[0],
      items: []
    });
  }

  // Pre-populate checklist categories
  const checklist = [
    { id: 'c1', category: '證件/金流', text: '護照與簽證 (如需)', completed: false },
    { id: 'c2', category: '證件/金流', text: '日圓現金與信用卡', completed: false },
    { id: 'c3', category: '衣物', text: '換洗衣物與外套', completed: false },
    { id: 'c4', category: '電子產品', text: '手機充電線與行動電源', completed: false },
    { id: 'c5', category: '盥洗用品', text: '牙刷盥洗組', completed: false }
  ];

  const newTrip = {
    id: Date.now().toString(),
    name,
    startDate,
    endDate,
    coverImage: coverImage || 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=800&q=80',
    desc: desc || '',
    totalBudget: Number(totalBudget) || 30000,
    city: city || '青森',
    recommendations: [],
    restaurants: [],
    days,
    checklist
  };

  if (dbCollection) {
    try {
      await dbCollection.insertOne(newTrip);
      res.status(201).json(newTrip);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  } else {
    const db = await readLocalDB();
    db.push(newTrip);
    await writeLocalDB(db);
    res.status(201).json(newTrip);
  }
});

// API: Update trip details
app.put('/api/trips/:id', async (req, res) => {
  const updatedTrip = { ...req.body, id: req.params.id };

  if (dbCollection) {
    try {
      // Remove MongoDB internal _id if present in body to avoid duplicate key error
      delete updatedTrip._id;
      const result = await dbCollection.replaceOne({ id: req.params.id }, updatedTrip);
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      res.json(updatedTrip);
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  } else {
    const db = await readLocalDB();
    const tripIdx = db.findIndex(t => t.id === req.params.id);
    if (tripIdx === -1) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    db[tripIdx] = updatedTrip;
    await writeLocalDB(db);
    res.json(updatedTrip);
  }
});

// API: Delete a trip
app.delete('/api/trips/:id', async (req, res) => {
  if (dbCollection) {
    try {
      const result = await dbCollection.deleteOne({ id: req.params.id });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  } else {
    const db = await readLocalDB();
    const filteredDb = db.filter(t => t.id !== req.params.id);
    if (db.length === filteredDb.length) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    await writeLocalDB(filteredDb);
    res.json({ success: true });
  }
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  broadcast({ type: 'online_count', count: wss.clients.size });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'trip_updated' || data.type === 'trip_deleted') {
        wss.clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }
    } catch (err) {
      console.error('WebSocket message handling error:', err);
    }
  });

  ws.on('close', () => {
    broadcast({ type: 'online_count', count: wss.clients.size });
  });
});

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Start server
initMongoDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
});
