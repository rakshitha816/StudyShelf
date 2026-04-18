// ============================================================
//  STUDY SHELF APP — Node.js + Express + MongoDB Backend
// ============================================================
require('dotenv').config();

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app = express();

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://shelfingstudy.netlify.app"
  ],
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Multer ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|jpeg|jpg|png|gif|webp|doc|docx|txt/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('File type not allowed'));
  }
});

// ── Database ─────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/studyshelf';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅  MongoDB connected — StudyShelf DB ready'))
  .catch(err => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'));
mongoose.connection.on('reconnected',  () => console.log('🔄  MongoDB reconnected'));

// ── Schemas ──────────────────────────────────────────────────
const classSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  day:   { type: String, required: true, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  start: { type: String, required: true },
  end:   { type: String, required: true },
  room:  { type: String, default: '' },
  color: { type: String, default: '#ff6b35' }
}, { timestamps: true });

const noteSchema = new mongoose.Schema({
  title:    { type: String, required: true, trim: true },
  subject:  { type: String, required: true, trim: true },
  type:     { type: String, enum: ['pdf','img','doc','other'], default: 'other' },
  fileName: { type: String, default: null },
  filePath: { type: String, default: null },
  fileUrl:  { type: String, default: null },
  size:     { type: String, default: null }
}, { timestamps: true });

const Class = mongoose.model('Class', classSchema);
const Note  = mongoose.model('Note',  noteSchema);

// ============================================================
//  ROOT ROUTE — visit http://localhost:5000 to see all your data
// ============================================================
app.get('/', async (req, res) => {
  try {
    const [classes, notes] = await Promise.all([Class.find(), Note.find()]);
    res.json({
      message: '📚 StudyShelf API is running!',
      database: 'connected ✅',
      summary: {
        totalClasses: classes.length,
        totalNotes:   notes.length
      },
      classes: classes,
      notes:   notes,
      endpoints: {
        classes: 'https://studyshelf-production.up.railway.app/api/classes',
        notes:   'https://studyshelf-production.up.railway.app/api/notes',
        backup:  'https://studyshelf-production.up.railway.app/api/backup'
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching data', error: err.message });
  }
});

// ============================================================
//  CLASSES ROUTES
// ============================================================
app.get('/api/classes', async (req, res) => {
  try {
    const classes = await Class.find().sort({ day: 1, start: 1 });
    res.json({ success: true, data: classes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/classes', async (req, res) => {
  try {
    const { name, day, start, end, room, color } = req.body;
    if (!name || !day || !start || !end)
      return res.status(400).json({ success: false, message: 'name, day, start, end are required' });
    const newClass = await Class.create({ name, day, start, end, room, color });
    res.status(201).json({ success: true, data: newClass });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/classes/:id', async (req, res) => {
  try {
    const updated = await Class.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Class not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/classes/:id', async (req, res) => {
  try {
    const deleted = await Class.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Class not found' });
    res.json({ success: true, message: 'Class deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  NOTES ROUTES
// ============================================================
app.get('/api/notes', async (req, res) => {
  try {
    const filter = {};
    if (req.query.subject) filter.subject = req.query.subject;
    if (req.query.search) {
      filter.$or = [
        { title:    { $regex: req.query.search, $options: 'i' } },
        { subject:  { $regex: req.query.search, $options: 'i' } },
        { fileName: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    const notes = await Note.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: notes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/notes', upload.single('file'), async (req, res) => {
  try {
    const { title, subject } = req.body;
    if (!title || !subject)
      return res.status(400).json({ success: false, message: 'title and subject are required' });
    let fileData = {};
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
      const typeMap = { pdf:'pdf', jpg:'img', jpeg:'img', png:'img', gif:'img', webp:'img', doc:'doc', docx:'doc' };
      fileData = {
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileUrl:  `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`,
        type:     typeMap[ext] || 'other',
        size:     (req.file.size / 1024).toFixed(0) + ' KB'
      };
    }
    const note = await Note.create({ title, subject, ...fileData });
    res.status(201).json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    const note = await Note.findByIdAndDelete(req.params.id);
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
    if (note.filePath && fs.existsSync(note.filePath)) fs.unlinkSync(note.filePath);
    res.json({ success: true, message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
//  BACKUP ROUTE
// ============================================================
app.get('/api/backup', async (req, res) => {
  try {
    const [classes, notes] = await Promise.all([Class.find(), Note.find()]);
    res.json({ success: true, exported: new Date(), classes, notes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () =>
  console.log(`🚀  StudyShelf backend running on http://localhost:${PORT}`));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is busy. Kill it with: taskkill /F /PID <PID>`);
    console.error(`   Find PID with: netstat -ano | findstr :${PORT}`);
    process.exit(1);
  }
});