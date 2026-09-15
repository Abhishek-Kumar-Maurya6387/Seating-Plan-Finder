require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('./models/User');
const EventLog = require('./models/EventLog');

const app = express();
const PORT = process.env.PORT || 3000;

// The ONLY email allowed to view the admin panel. Override via env var if
// you ever need to change it without editing code.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'abhishek.2428cseai17@kiet.edu').toLowerCase();

// --- MongoDB connection (optional but recommended) ---
// Set MONGODB_URI as an environment variable when you deploy (Render/Vercel
// dashboard → Environment Variables). Login/usage tracking simply won't
// persist if it's missing, but the seating lookup itself still works fine.
let dbReady = false;
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
      dbReady = true;
      console.log('MongoDB connected.');
    })
    .catch((err) => {
      console.error('MongoDB connection failed — login tracking disabled:', err.message);
    });
} else {
  console.warn('MONGODB_URI not set — login tracking disabled, seating lookup still works.');
}

const KIET_EMAIL_RE = /^[^\s@]+@kiet\.edu$/i;

// Load the seating dataset once into memory at startup.
const DATA_PATH = path.join(__dirname, 'data.json');
let seatingData = { students: {}, rooms: {} };
try {
  seatingData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(`Loaded seating data for ${Object.keys(seatingData.students).length} roll numbers, ${Object.keys(seatingData.rooms).length} room-sessions.`);
} catch (err) {
  console.error('Could not load data.json:', err.message);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper: parse "DD-MM-YYYY" into a Date object
function parseDate(d) {
  const [dd, mm, yyyy] = d.split('-').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

app.get('/api/lookup/:roll', (req, res) => {
  const roll = req.params.roll.trim();
  const student = seatingData.students[roll];

  if (!student) {
    if (dbReady) {
      EventLog.create({ type: 'lookup_not_found', detail: roll }).catch(() => {});
    }
    return res.status(404).json({ error: 'No record found for this roll number in the current dataset.' });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sessions = student.sessions.map((s) => ({
    ...s,
    isPast: parseDate(s.date) < today,
  }));

  const upcoming = sessions.filter((s) => !s.isPast);
  const past = sessions.filter((s) => s.isPast);

  res.json({
    roll_no: student.roll_no,
    branch: student.branch,
    sem: student.sem,
    section: student.section,
    next_session: upcoming[0] || null,
    upcoming_sessions: upcoming.slice(1),
    past_sessions: past,
  });
});

app.get('/api/room/:roomKey', (req, res) => {
  const room = seatingData.rooms[req.params.roomKey];
  if (!room) {
    return res.status(404).json({ error: 'Room data not found.' });
  }
  res.json(room);
});

app.get('/api/stats', (req, res) => {
  res.json({ total_students: Object.keys(seatingData.students).length });
});

// --- Login / usage tracking ---
app.post('/api/login', async (req, res) => {
  const { email, rollNo } = req.body || {};
  if (!email || !KIET_EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please use a valid @kiet.edu email address.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();

  if (!dbReady) {
    // DB not configured/unreachable — still let the student in, just can't
    // record the visit. Seating lookup itself doesn't depend on this.
    return res.json({ ok: true, tracked: false });
  }

  try {
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      existing.lastLoginAt = new Date();
      existing.loginCount += 1;
      if (rollNo) existing.rollNo = rollNo;
      await existing.save();
    } else {
      await User.create({ email: cleanEmail, rollNo: rollNo || null });
    }
    res.json({ ok: true, tracked: true });
  } catch (err) {
    console.error('Login tracking failed:', err.message);
    // Still let them into the app even if the DB write failed.
    res.json({ ok: true, tracked: false });
  }
});

// Simple usage/admin dashboard — restricted to ADMIN_EMAIL only.
// The signed-in email is sent as a query param; the server checks it against
// the hardcoded ADMIN_EMAIL constant above (not client-configurable).
app.get('/api/admin/summary', async (req, res) => {
  const email = String(req.query.email || '').toLowerCase().trim();
  if (email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden — admin access only.' });
  }
  if (!dbReady) {
    return res.status(503).json({ error: 'Database not connected — usage tracking unavailable.' });
  }

  try {
    const users = await User.find().sort({ lastLoginAt: -1 }).lean();
    const totalLogins = users.reduce((sum, u) => sum + (u.loginCount || 0), 0);

    const errorLogs = await EventLog.find({ type: 'lookup_not_found' }).sort({ at: -1 }).limit(200).lean();
    const errorCount = await EventLog.countDocuments({ type: 'lookup_not_found' });

    // Branches/sems that have zero published seating anywhere in the dataset.
    const branchStatus = {};
    for (const student of Object.values(seatingData.students)) {
      const key = `${student.branch || 'Unknown'} · Sem ${student.sem || '?'}`;
      if (!branchStatus[key]) branchStatus[key] = { total: 0, published: 0 };
      branchStatus[key].total += 1;
      const hasPublished = (student.sessions || []).some((s) => s.seating_published);
      if (hasPublished) branchStatus[key].published += 1;
    }
    const branchesMissingSeating = Object.entries(branchStatus)
      .filter(([, v]) => v.published === 0)
      .map(([k, v]) => ({ branch_sem: k, students: v.total }));

    res.json({
      unique_users: users.length,
      total_logins: totalLogins,
      total_students_in_dataset: Object.keys(seatingData.students).length,
      total_rooms_published: Object.keys(seatingData.rooms).length,
      error_count: errorCount,
      recent_errors: errorLogs.map((e) => ({ rollNo: e.detail, at: e.at })),
      branches_missing_seating: branchesMissingSeating,
      users: users.map((u) => ({
        email: u.email, rollNo: u.rollNo, loginCount: u.loginCount,
        firstLoginAt: u.firstLoginAt, lastLoginAt: u.lastLoginAt,
      })),
    });
  } catch (err) {
    console.error('Admin summary failed:', err.message);
    res.status(500).json({ error: 'Could not build admin summary.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Seating plan server running on port ${PORT}`);
  });
}

module.exports = app;
