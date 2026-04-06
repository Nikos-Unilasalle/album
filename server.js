require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configuration ────────────────────────────────────────────────────────────
const PASSWORD = process.env.APP_PASSWORD || 'apex2024';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const MAX_WIDTH = 1920;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

// ─── Ensure directories exist ─────────────────────────────────────────────────
[UPLOADS_DIR, path.join(__dirname, 'data')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Supabase Setup ───────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase configuration ready');
} else {
  console.log('⚠️ Supabase URL or Key missing, using local JSON fallback');
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function readDB() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('app_data').select('data').eq('id', 1).maybeSingle();
      if (error) {
        console.error('❌ Supabase Read Error:', error.message);
        throw new Error('Supabase Read Error: ' + error.message);
      }
      if (data && data.data) {
          const db = data.data;
          if (!db.users) db.users = [];
          if (!db.history) db.history = [];
          if (db.users.length === 0) {
              db.users.push({ id: uuidv4(), username: 'admin', password: PASSWORD, role: 'admin' });
          }
          return db;
      }
    } catch (e) {
      console.error('❌ Database Access Exception:', e.message);
    }
  }

  try {
    const fileContent = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '';
    const db = JSON.parse(fileContent || '{"categories": [], "photos": [], "users": [], "history": []}');
    if (!db.users) db.users = [];
    if (!db.history) db.history = [];
    if (db.users.length === 0) {
        db.users.push({ id: uuidv4(), username: 'admin', password: PASSWORD, role: 'admin' });
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    }
    return db;
  } catch (e) {
    console.error('❌ Local File Read Error:', e.message);
    return { categories: [], photos: [], users: [], history: [] };
  }
}

async function writeDB(dbData) {
  if (supabase) {
    try {
      const { error } = await supabase.from('app_data').upsert({ id: 1, data: dbData });
      if (error) console.error('❌ Supabase Write Error:', error.message);
      else return;
    } catch (e) { console.error('❌ Supabase Write Exception:', e.message); }
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(dbData, null, 2));
  } catch (e) {
    console.error('❌ Local File Write Error:', e.message);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

function requireAdmin(req, res, next) {
  if (req.session && req.session.authenticated && req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Accès refusé' });
}

// ─── Multer config ────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|avif/i;
    const isAllowed = allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype);
    if (isAllowed) cb(null, true);
    else cb(new Error('Format non supporté. Utilisez JPG, PNG, GIF, WebP.'));
  }
});

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const db = await readDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (user) {
    req.session.authenticated = true;
    req.session.role = user.role;
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, role: user.role, userId: user.id, username: user.username, settings: user.settings || null });
  } else {
    // legacy fallback
    if (username === 'admin' && password === PASSWORD && db.users.length === 0) {
      req.session.authenticated = true;
      req.session.role = 'admin';
      req.session.userId = '00000000-0000-0000-0000-000000000000';
      req.session.username = 'admin';
      res.json({ success: true, role: 'admin', userId: req.session.userId, username: 'admin', settings: null });
      return;
    }
    res.status(401).json({ error: 'Identifiants incorrects' });
  }
});

app.put('/api/users/settings', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const userId = req.session.userId;
    const idx = db.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
        db.users[idx].settings = { ...(db.users[idx].settings || {}), ...req.body };
        await writeDB(db);
        res.json({ success: true, settings: db.users[idx].settings });
    } else {
        res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ 
    authenticated: !!(req.session && req.session.authenticated),
    role: req.session ? req.session.role : null,
    username: req.session ? req.session.username : null,
    userId: req.session ? req.session.userId : null
  });
});

// ─── Admin Users & History Routes ─────────────────────────────────────────────
app.get('/api/users', requireAdmin, async (req, res) => {
  const db = await readDB();
  res.json(db.users || []);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  const db = await readDB();
  if (db.users.some(u => u.username === username)) return res.status(400).json({ error: 'Cet utilisateur existe déjà' });
  const newUser = { id: uuidv4(), username, password, role: role || 'user' };
  db.users.push(newUser);
  await writeDB(db);
  res.json(newUser);
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const db = await readDB();
  db.users = db.users.filter(u => u.id !== req.params.id);
  await writeDB(db);
  res.json({ success: true });
});

app.get('/api/history', requireAdmin, async (req, res) => {
  const db = await readDB();
  res.json(db.history || []);
});

app.get('/api/history/csv', requireAdmin, async (req, res) => {
  const db = await readDB();
  const rows = ['Date,Utilisateur,Action,Details'];
  (db.history || []).forEach(h => {
     rows.push(`"${h.timestamp}","${h.username || 'Inconnu'}","${h.action}","${h.details.replace(/"/g, '""')}"`);
  });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="historique.csv"');
  res.send(Buffer.from('\ufeff' + rows.join('\n'), 'utf8')); // UTF-8 BOM
});

// ─── Categories routes ────────────────────────────────────────────────────────
app.get('/api/categories', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.categories || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/categories', requireAdmin, async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    const db = await readDB();
    const category = { id: uuidv4(), name: name.trim(), color: color || '#6366f1', createdAt: new Date().toISOString() };
    db.categories.push(category);
    await writeDB(db);
    res.json(category);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/categories/:id', requireAdmin, async (req, res) => {
  try {
    const db = await readDB();
    const idx = db.categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Catégorie non trouvée' });
    db.categories[idx] = { ...db.categories[idx], ...req.body, id: req.params.id };
    await writeDB(db);
    res.json(db.categories[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res) => {
  try {
    const db = await readDB();
    const catId = req.params.id;
    db.categories = db.categories.filter(c => c.id !== catId);
    db.photos = db.photos.map(p => {
      const categoryIds = (p.categoryIds || (p.categoryId ? [p.categoryId] : [])).filter(id => id !== catId);
      return { ...p, categoryIds, categoryId: categoryIds[0] || null };
    });
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Photos routes ────────────────────────────────────────────────────────────
app.get('/api/photos', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.photos || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/photos/upload', requireAuth, upload.array('photos', 50), async (req, res) => {
  if (req.session.role === 'visitor') return res.status(403).json({ error: 'Non autorisé' });
  let { categoryId, categoryIds } = req.body;
  if (!categoryIds) categoryIds = categoryId ? (Array.isArray(categoryId) ? categoryId : [categoryId]) : [];
  else if (!Array.isArray(categoryIds)) categoryIds = [categoryIds];
  let db;
  try { db = await readDB(); } catch (e) { return res.status(500).json({ error: "Failed to read DB" }); }

  const uploaded = [];
  for (const file of req.files) {
    try {
      const id = uuidv4();
      const ext = '.jpg';
      const filename = `${id}${ext}`;
      const thumbFilename = `thumb_${id}${ext}`;
      const filepath = path.join(UPLOADS_DIR, filename);
      const thumbpath = path.join(UPLOADS_DIR, thumbFilename);

      let sharpImg = sharp(file.buffer).rotate();
      const meta = await sharpImg.metadata();
      if (meta.width > MAX_WIDTH) sharpImg = sharpImg.resize({ width: MAX_WIDTH, withoutEnlargement: true });

      let photoFilename, photoThumbFilename, finalMeta, photoSize, cloudinaryId;

      if (useCloudinary) {
        console.log(`☁️ Uploading: ${file.originalname}...`);
        const buffer = await sharpImg.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream({ folder: 'album-apex' }, (error, res) => {
            if (error) reject(error); else resolve(res);
          }).end(buffer);
        });
        photoFilename = result.secure_url;
        photoThumbFilename = result.secure_url.replace('/upload/', '/upload/w_400,h_400,c_fill,q_75/');
        finalMeta = { width: result.width, height: result.height };
        photoSize = result.bytes;
        cloudinaryId = result.public_id;
      } else {
        await sharpImg.jpeg({ quality: 85, mozjpeg: true }).toFile(filepath);
        await sharp(file.buffer).rotate().resize({ width: 400, height: 400, fit: 'cover' }).jpeg({ quality: 75 }).toFile(thumbpath);
        finalMeta = await sharp(filepath).metadata();
        photoSize = fs.statSync(filepath).size;
      }

      const photo = {
        id, filename: photoFilename || filename, thumbFilename: photoThumbFilename || thumbFilename,
        cloudinaryId, originalName: file.originalname, categoryIds, categoryId: categoryIds[0] || null,
        width: finalMeta.width, height: finalMeta.height, size: photoSize,
        uploadedAt: new Date().toISOString(), uploadedBy: req.session.userId, preferences: {}
      };

      db.photos.push(photo);
      uploaded.push(photo);
    } catch (err) { console.error('❌ Upload error:', err.message); }
  }

  try {
    db.history.push({ id: uuidv4(), userId: req.session.userId, username: req.session.username, action: 'upload', details: `${uploaded.length} photo(s)`, timestamp: new Date().toISOString() });
    await writeDB(db);
    res.json(uploaded);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/photos/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const idx = db.photos.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Photo non trouvée' });
    if (req.session.role !== 'admin' && db.photos[idx].uploadedBy !== req.session.userId) {
       return res.status(403).json({ error: 'Non autorisé' });
    }
    db.photos[idx] = { ...db.photos[idx], ...req.body, id: req.params.id };
    await writeDB(db);
    res.json(db.photos[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/photos-bulk', requireAuth, async (req, res) => {
  const { ids, updates } = req.body;
  if (!ids || !updates) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const db = await readDB();
    let count = 0;
    db.photos = db.photos.map(p => {
      if (ids.includes(p.id)) {
        if (req.session.role === 'admin' || p.uploadedBy === req.session.userId) {
          count++;
          return { ...p, ...updates, id: p.id };
        }
      }
      return p;
    });
    await writeDB(db);
    res.json({ success: true, count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/photos/:id/preference', requireAuth, async (req, res) => {
  const { icon } = req.body;
  try {
    const db = await readDB();
    const photo = db.photos.find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
    if (!photo.preferences) photo.preferences = {};
    if (icon) {
      photo.preferences[req.session.userId] = icon;
    } else {
      delete photo.preferences[req.session.userId];
    }
    await writeDB(db);
    res.json(photo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function removePhoto(photo) {
  if (useCloudinary && photo.cloudinaryId) {
    try { await cloudinary.uploader.destroy(photo.cloudinaryId); } catch (e) { }
  } else {
    [photo.filename, photo.thumbFilename].forEach(f => {
      if (f && !f.startsWith('http')) {
        const fp = path.join(UPLOADS_DIR, f);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    });
  }
}

app.delete('/api/photos/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const photo = db.photos.find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo non trouvée' });
    
    if (req.session.role !== 'admin' && photo.uploadedBy !== req.session.userId) {
      return res.status(403).json({ error: 'Action non autorisée' });
    }

    await removePhoto(photo);
    db.photos = db.photos.filter(p => p.id !== req.params.id);
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/photos', requireAuth, async (req, res) => {
  const { ids } = req.body;
  try {
    const db = await readDB();
    const toDelete = db.photos.filter(p => ids.includes(p.id));
    for (const photo of toDelete) {
      if (req.session.role !== 'admin' && photo.uploadedBy !== req.session.userId) {
        return res.status(403).json({ error: 'Action non autorisée sur certaines photos' });
      }
    }
    await Promise.all(toDelete.map(p => removePhoto(p)));
    db.photos = db.photos.filter(p => !ids.includes(p.id));
    await writeDB(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/photos/contact-sheet', requireAuth, async (req, res) => {
  const { ids, options } = req.body;
  const opt = options || {};
  try {
    const db = await readDB();
    const photos = db.photos.filter(p => ids.includes(p.id));
    if (photos.length === 0) return res.status(404).json({ error: 'Aucune photo' });

    db.history.push({ id: uuidv4(), userId: req.session.userId, username: req.session.username, action: 'planche contact', details: `${photos.length} photo(s)`, timestamp: new Date().toISOString() });
    await writeDB(db);

    const WIDTH = parseInt(opt.width) || 1200;
    const HEIGHT = parseInt(opt.height) || 1600;
    const GAP = parseInt(opt.gap) || 24;
    const BORDER = parseInt(opt.border) || 8;
    const BG_COLOR = opt.backgroundColor || 'black';
    const BORDER_COLOR = opt.borderColor || 'white';

    let rects = [{x: GAP, y: GAP, w: WIDTH - 2*GAP, h: HEIGHT - 2*GAP}];
    while(rects.length < photos.length) {
        rects.sort((a,b) => (b.w * b.h) - (a.w * a.h));
        const toSplit = rects.shift();
        const splitVertically = toSplit.w > toSplit.h;
        const ratio = 0.4 + Math.random() * 0.2; 
        
        if (splitVertically) {
            const w1 = Math.floor((toSplit.w - GAP) * ratio);
            const w2 = toSplit.w - GAP - w1;
            rects.push({x: toSplit.x, y: toSplit.y, w: w1, h: toSplit.h});
            rects.push({x: toSplit.x + w1 + GAP, y: toSplit.y, w: w2, h: toSplit.h});
        } else {
            const h1 = Math.floor((toSplit.h - GAP) * ratio);
            const h2 = toSplit.h - GAP - h1;
            rects.push({x: toSplit.x, y: toSplit.y, w: toSplit.w, h: h1});
            rects.push({x: toSplit.x, y: toSplit.y + h1 + GAP, w: toSplit.w, h: h2});
        }
    }

    const composites = [];
    const FIT = opt.fit === 'contain' ? 'contain' : 'cover';

    for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const rect = rects[i];
        
        let buffer;
        if (photo.filename.startsWith('http')) {
            const nodeFetch = await import('node-fetch').then(m => m.default).catch(() => fetch);
            const response = await nodeFetch(photo.filename);
            const ab = await response.arrayBuffer();
            buffer = Buffer.from(ab);
        } else {
            const filepath = path.join(UPLOADS_DIR, photo.filename);
            buffer = fs.readFileSync(filepath);
        }

        const rw = Math.max(10, Math.round(rect.w - BORDER*2));
        const rh = Math.max(10, Math.round(rect.h - BORDER*2));

        const resized = await sharp(buffer)
           .resize(rw, rh, { fit: FIT, background: { r: 0, g: 0, b: 0, alpha: 0 } })
           .extend({ top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, background: BORDER_COLOR })
           .toBuffer();
           
        composites.push({ input: resized, top: Math.round(rect.y), left: Math.round(rect.x) });
    }

    const contactSheet = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: BG_COLOR } })
         .composite(composites)
         .jpeg({ quality: 90 })
         .toBuffer();

    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename="planche-contact-${Date.now()}.jpg"`
    });
    res.send(contactSheet);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ─── Download routes ──────────────────────────────────────────────────────────
app.get('/api/download/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const photo = db.photos.find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo non trouvée' });

    db.history.push({ id: uuidv4(), userId: req.session.userId, username: req.session.username, action: 'download', details: `1 photo`, timestamp: new Date().toISOString() });
    await writeDB(db);

    if (photo.filename.startsWith('http')) {
      res.redirect(photo.filename.replace('/upload/', '/upload/fl_attachment/'));
    } else {
      const filepath = path.join(UPLOADS_DIR, photo.filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier introuvable' });
      res.download(filepath, photo.originalName || photo.filename);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/download/bulk', requireAuth, async (req, res) => {
  const { ids } = req.body;
  try {
    const db = await readDB();
    const photos = db.photos.filter(p => ids.includes(p.id));
    if (photos.length === 0) return res.status(404).json({ error: 'Aucune photo trouvée' });

    db.history.push({ id: uuidv4(), userId: req.session.userId, username: req.session.username, action: 'download batch', details: `${photos.length} photo(s)`, timestamp: new Date().toISOString() });
    await writeDB(db);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="album-apex-${Date.now()}.zip"`
    });
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error(err); res.end(); });
    archive.pipe(res);

    for (const photo of photos) {
      if (photo.filename.startsWith('http')) {
        const stream = await new Promise((resolve) => {
          https.get(photo.filename, (response) => {
            if (response.statusCode === 200) resolve(response); else resolve(null);
          }).on('error', () => resolve(null));
        });
        if (stream) archive.append(stream, { name: photo.originalName || photo.id + '.jpg' });
      } else {
        const filepath = path.join(UPLOADS_DIR, photo.filename);
        if (fs.existsSync(filepath)) archive.file(filepath, { name: photo.originalName || photo.filename });
      }
    }
    archive.finalize();
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message }); }
});

// ─── Share routes ─────────────────────────────────────────────────────────────
app.post('/api/shares', requireAuth, async (req, res) => {
  const { photoIds } = req.body;
  if (!photoIds || !photoIds.length) return res.status(400).json({ error: 'Aucune photo à partager' });
  try {
    const db = await readDB();
    if (!db.shares) db.shares = [];
    const share = { id: uuidv4().substring(0, 8), photoIds, createdAt: new Date().toISOString(), createdBy: req.session.userId };
    db.shares.push(share);
    await writeDB(db);
    res.json(share);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/public/shares/:id', async (req, res) => {
  try {
    const db = await readDB();
    const share = (db.shares || []).find(s => s.id === req.params.id);
    if (!share) return res.status(404).json({ error: 'Lien invalide ou expiré' });
    const photos = db.photos.filter(p => share.photoIds.includes(p.id)).map(p => ({
        id: p.id,
        filename: p.filename,
        thumbFilename: p.thumbFilename,
        originalName: p.originalName,
        width: p.width,
        height: p.height
    }));
    const sharedByUser = (db.users || []).find(u => u.id === share.createdBy);
    res.json({ photos, sharedBy: sharedByUser ? sharedByUser.username : 'Anonyme' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/public/download/:shareId/:photoId', async (req, res) => {
  try {
    const db = await readDB();
    const share = (db.shares || []).find(s => s.id === req.params.shareId);
    if (!share) return res.status(404).json({ error: 'Lien invalide' });
    if (!share.photoIds.includes(req.params.photoId)) return res.status(403).json({ error: 'Photo non autorisée' });
    const photo = db.photos.find(p => p.id === req.params.photoId);
    if (!photo) return res.status(404).json({ error: 'Photo non trouvée' });
    if (photo.filename.startsWith('http')) {
      res.redirect(photo.filename.replace('/upload/', '/upload/fl_attachment/'));
    } else {
      const filepath = path.join(UPLOADS_DIR, photo.filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier introuvable' });
      res.download(filepath, photo.originalName || photo.filename);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get('/share/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'share.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Album Apex started on http://localhost:${PORT}`);
});
