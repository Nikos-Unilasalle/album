const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configuration ────────────────────────────────────────────────────────────
const PASSWORD = process.env.APP_PASSWORD || 'apex2024';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const MAX_WIDTH = 1920;

// ─── Ensure directories exist ─────────────────────────────────────────────────
[UPLOADS_DIR, path.join(__dirname, 'data')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── DB helpers ───────────────────────────────────────────────────────────────
function readDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { categories: [], photos: [] };
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { categories: [], photos: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'apex-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24h
}));

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

// ─── Multer config ────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|avif/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format non supporté. Utilisez JPG, PNG, GIF, WebP.'));
    }
  }
});

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ─── Categories routes ────────────────────────────────────────────────────────
app.get('/api/categories', requireAuth, (req, res) => {
  const db = readDB();
  res.json(db.categories);
});

app.post('/api/categories', requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
  const db = readDB();
  const category = {
    id: uuidv4(),
    name: name.trim(),
    color: color || '#6366f1',
    createdAt: new Date().toISOString()
  };
  db.categories.push(category);
  writeDB(db);
  res.json(category);
});

app.put('/api/categories/:id', requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Catégorie non trouvée' });
  db.categories[idx] = { ...db.categories[idx], ...req.body, id: req.params.id };
  writeDB(db);
  res.json(db.categories[idx]);
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const db = readDB();
  const catId = req.params.id;
  db.categories = db.categories.filter(c => c.id !== catId);
  // Unassign photos from deleted category
  db.photos = db.photos.map(p => ({
    ...p,
    categoryId: p.categoryId === catId ? null : p.categoryId
  }));
  writeDB(db);
  res.json({ success: true });
});

// ─── Photos routes ────────────────────────────────────────────────────────────
app.get('/api/photos', requireAuth, (req, res) => {
  const db = readDB();
  res.json(db.photos);
});

app.post('/api/photos/upload', requireAuth, upload.array('photos', 50), async (req, res) => {
  const { categoryId } = req.body;
  const db = readDB();
  const uploaded = [];

  for (const file of req.files) {
    try {
      const id = uuidv4();
      const ext = '.jpg'; // Always save as JPEG
      const filename = `${id}${ext}`;
      const thumbFilename = `thumb_${id}${ext}`;
      const filepath = path.join(UPLOADS_DIR, filename);
      const thumbpath = path.join(UPLOADS_DIR, thumbFilename);

      // Resize full image to max 1920px width
      let sharpImg = sharp(file.buffer).rotate(); // auto-rotate by EXIF

      const meta = await sharpImg.metadata();
      if (meta.width > MAX_WIDTH) {
        sharpImg = sharpImg.resize({ width: MAX_WIDTH, withoutEnlargement: true });
      }
      await sharpImg.jpeg({ quality: 85, mozjpeg: true }).toFile(filepath);

      // Create thumbnail (400px)
      await sharp(file.buffer)
        .rotate()
        .resize({ width: 400, height: 400, fit: 'cover' })
        .jpeg({ quality: 75 })
        .toFile(thumbpath);

      const finalMeta = await sharp(filepath).metadata();

      const photo = {
        id,
        filename,
        thumbFilename,
        originalName: file.originalname,
        categoryId: categoryId || null,
        width: finalMeta.width,
        height: finalMeta.height,
        size: fs.statSync(filepath).size,
        uploadedAt: new Date().toISOString()
      };

      db.photos.push(photo);
      uploaded.push(photo);
    } catch (err) {
      console.error('Erreur traitement photo:', file.originalname, err.message);
    }
  }

  writeDB(db);
  res.json(uploaded);
});

app.put('/api/photos/:id', requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.photos.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Photo non trouvée' });
  db.photos[idx] = { ...db.photos[idx], ...req.body, id: req.params.id };
  writeDB(db);
  res.json(db.photos[idx]);
});

app.put('/api/photos/reorder', requireAuth, (req, res) => {
  const { photoIds } = req.body;
  const db = readDB();
  // Reorder photos array based on provided order
  const photoMap = new Map(db.photos.map(p => [p.id, p]));
  const reordered = photoIds.map(id => photoMap.get(id)).filter(Boolean);
  const rest = db.photos.filter(p => !photoIds.includes(p.id));
  db.photos = [...reordered, ...rest];
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/photos/:id', requireAuth, (req, res) => {
  const db = readDB();
  const photo = db.photos.find(p => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo non trouvée' });

  // Delete files
  [photo.filename, photo.thumbFilename].forEach(f => {
    if (f) {
      const fp = path.join(UPLOADS_DIR, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  });

  db.photos = db.photos.filter(p => p.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/photos', requireAuth, (req, res) => {
  const { ids } = req.body;
  const db = readDB();

  ids.forEach(id => {
    const photo = db.photos.find(p => p.id === id);
    if (photo) {
      [photo.filename, photo.thumbFilename].forEach(f => {
        if (f) {
          const fp = path.join(UPLOADS_DIR, f);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
      });
    }
  });

  db.photos = db.photos.filter(p => !ids.includes(p.id));
  writeDB(db);
  res.json({ success: true });
});

// ─── Download routes ──────────────────────────────────────────────────────────
app.get('/api/download/:id', requireAuth, (req, res) => {
  const db = readDB();
  const photo = db.photos.find(p => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo non trouvée' });

  const filepath = path.join(UPLOADS_DIR, photo.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier introuvable' });

  res.download(filepath, photo.originalName || photo.filename);
});

app.post('/api/download/bulk', requireAuth, (req, res) => {
  const { ids } = req.body;
  const db = readDB();
  const photos = db.photos.filter(p => ids.includes(p.id));

  if (photos.length === 0) return res.status(404).json({ error: 'Aucune photo trouvée' });

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="album-apex-${Date.now()}.zip"`
  });

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error(err); res.end(); });
  archive.pipe(res);

  photos.forEach(photo => {
    const filepath = path.join(UPLOADS_DIR, photo.filename);
    if (fs.existsSync(filepath)) {
      archive.file(filepath, { name: photo.originalName || photo.filename });
    }
  });

  archive.finalize();
});

// ─── Catch-all: serve frontend ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Album Apex démarré sur http://localhost:${PORT}`);
  console.log(`🔑 Mot de passe: ${PASSWORD}`);
});
