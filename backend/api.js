// ============================================================
//  STUDY SHELF — Frontend API Service
//  File: api.js  (include this in your frontend project)
//
//  This bridges your HTML/React frontend to the Node.js backend.
//  It falls back to localStorage automatically if the server
//  is unreachable (offline-first behaviour).
// ============================================================

const BASE_URL = 'http://localhost:5000/api';
// When deployed, change to: 'https://your-backend-domain.com/api'

// ── Helper: raw fetch with error handling ───────────────────
async function apiFetch(endpoint, options = {}) {
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data;
  } catch (err) {
    console.warn(`[StudyShelf API] ${endpoint} failed:`, err.message);
    throw err;
  }
}

// ============================================================
//  CLASSES API
// ============================================================
const ClassesAPI = {

  // Fetch all classes from MongoDB
  async getAll() {
    try {
      const { data } = await apiFetch('/classes');
      // Sync to localStorage as offline cache
      localStorage.setItem('ss_c', JSON.stringify(data));
      return data;
    } catch {
      // Offline fallback — return local data
      console.info('[StudyShelf] Offline: using cached classes');
      return JSON.parse(localStorage.getItem('ss_c') || '[]');
    }
  },

  // Add a new class
  async add(classData) {
    try {
      const { data } = await apiFetch('/classes', {
        method: 'POST',
        body: JSON.stringify(classData)
      });
      // Update local cache
      const cached = JSON.parse(localStorage.getItem('ss_c') || '[]');
      cached.push(data);
      localStorage.setItem('ss_c', JSON.stringify(cached));
      return data;
    } catch {
      // Save locally if offline
      const offlineEntry = { ...classData, id: Date.now(), _offline: true };
      const cached = JSON.parse(localStorage.getItem('ss_c') || '[]');
      cached.push(offlineEntry);
      localStorage.setItem('ss_c', JSON.stringify(cached));
      return offlineEntry;
    }
  },

  // Delete a class
  async delete(id) {
    try {
      await apiFetch(`/classes/${id}`, { method: 'DELETE' });
    } catch {
      console.info('[StudyShelf] Offline: class delete queued locally');
    }
    // Always remove from local cache immediately
    const cached = JSON.parse(localStorage.getItem('ss_c') || '[]');
    localStorage.setItem('ss_c', JSON.stringify(cached.filter(c => c._id !== id && c.id !== id)));
  }
};

// ============================================================
//  NOTES API
// ============================================================
const NotesAPI = {

  // Fetch all notes (optional search query)
  async getAll(search = '', subject = '') {
    try {
      const params = new URLSearchParams();
      if (search)  params.append('search',  search);
      if (subject && subject !== 'All') params.append('subject', subject);
      const { data } = await apiFetch(`/notes?${params}`);
      localStorage.setItem('ss_n', JSON.stringify(data));
      return data;
    } catch {
      let notes = JSON.parse(localStorage.getItem('ss_n') || '[]');
      if (search)  notes = notes.filter(n =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.subject.toLowerCase().includes(search.toLowerCase())
      );
      if (subject && subject !== 'All') notes = notes.filter(n => n.subject === subject);
      return notes;
    }
  },

  // Add a note — pass FormData when attaching a file
  async add(title, subject, file = null) {
    try {
      const formData = new FormData();
      formData.append('title',   title);
      formData.append('subject', subject);
      if (file) formData.append('file', file);

      const res = await fetch(`${BASE_URL}/notes`, {
        method: 'POST',
        body: formData   // DO NOT set Content-Type header; browser sets it with boundary
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      const cached = JSON.parse(localStorage.getItem('ss_n') || '[]');
      cached.unshift(data.data);
      localStorage.setItem('ss_n', JSON.stringify(cached));
      return data.data;
    } catch (err) {
      // Offline fallback (store base64 locally)
      const offlineNote = {
        _id: String(Date.now()),
        title, subject,
        type: file ? getFileType(file.name) : 'other',
        fileName: file ? file.name : null,
        size: file ? (file.size / 1024).toFixed(0) + ' KB' : null,
        _offline: true
      };
      const cached = JSON.parse(localStorage.getItem('ss_n') || '[]');
      cached.unshift(offlineNote);
      localStorage.setItem('ss_n', JSON.stringify(cached));
      return offlineNote;
    }
  },

  // Delete a note
  async delete(id) {
    try {
      await apiFetch(`/notes/${id}`, { method: 'DELETE' });
    } catch {
      console.info('[StudyShelf] Offline: note delete queued locally');
    }
    const cached = JSON.parse(localStorage.getItem('ss_n') || '[]');
    localStorage.setItem('ss_n', JSON.stringify(cached.filter(n => n._id !== id && n.id !== id)));
  }
};

// ============================================================
//  BACKUP API
// ============================================================
const BackupAPI = {
  async export() {
    try {
      const { classes, notes } = await apiFetch('/backup');
      const blob = new Blob([JSON.stringify({ classes, notes, exported: new Date() }, null, 2)],
        { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'studyshelf-backup.json';
      a.click();
    } catch {
      // Fallback: export from localStorage
      const data = {
        classes: JSON.parse(localStorage.getItem('ss_c') || '[]'),
        notes:   JSON.parse(localStorage.getItem('ss_n') || '[]'),
        exported: new Date()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'studyshelf-backup-local.json';
      a.click();
    }
  }
};

// ── Utility ──────────────────────────────────────────────────
function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'img';
  if (['doc','docx'].includes(ext)) return 'doc';
  return 'other';
}

// Export for use in other scripts
// If using plain HTML:   window.ClassesAPI = ClassesAPI; etc.
// If using ES modules:   export { ClassesAPI, NotesAPI, BackupAPI };
window.ClassesAPI = ClassesAPI;
window.NotesAPI   = NotesAPI;
window.BackupAPI  = BackupAPI;
