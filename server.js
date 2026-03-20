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
      const { data, error } = await supabase
        .from('app_data')
        .select('data')
        .eq('id', 1)
        .maybeSingle();

      if (error) {
        console.error('❌ Supabase Read Error:', error.message);
        throw new Error('Supabase Read Error: ' + error.message);
      }

      if (data && data.data) return data.data;

      console.log('ℹ️ No existing data in Supabase app_data table, returning empty defaults');
    } catch (e) {
      console.error('❌ Database Access Exception:', e.message);
      // We don't want to break the whole app, but we need users to know why images are missing
    }
  }

  try {
    if (!fs.existsSync(DATA_FILE)) return { categories: [], photos: [] };
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(content || '{"categories": [], "photos": []}');
  } catch (e) {
    console.error('❌ Local File Read Error:', e.message);
    return { categories: [], photos: [] };
  }
}

async function writeDB(dbData) {
  if (supabase) {
    try {
      const { error } = await supabase
        .from('app_data')
        .upsert({ id: 1, data: dbData });

      if (error) {
        console.error('❌ Supabase Write Error:', error.message);
        // If upsert fails, we still try to write locally as a safety measure
      } else {
        return;
      }
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
    const isAllowed = allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype);
    if (isAllowed) {
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
app.get('/api/categories', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.categories || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/categories', requireAuth, async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

  try {
    const db = await readDB();
    const category = {
      id: uuidv4(),
      name: name.trim(),
      color: color || '#6366f1',
      createdAt: new Date().toISOString()
    };
    db.categories = db.categories || [];
    db.categories.push(category);
    await writeDB(db);
    res.json(category);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const idx = db.categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Catégorie non trouvée' });
    db.categories[idx] = { ...db.categories[idx], ...req.body, id: req.params.id };
    await writeDB(db);
    res.json(db.categories[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const catId = req.params.id;
    db.categories = db.categories.filter(c => c.id !== catId);
    db.photos = db.photos.map(p => ({
      ...p,
      categoryId: p.categoryId === catId ? null : p.categoryId
    }));
    await writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Photos routes ────────────────────────────────────────────────────────────
app.get('/api/photos', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.photos || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/photos/upload', requireAuth, upload.array('photos', 50), async (req, res) => {
  const { categoryId } = req.body;
  let db;
  try {
    db = await readDB();
  } catch (e) {
    return res.status(500).json({ error: "Failed to read database: " + e.message });
  }

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
      if (meta.width > MAX_WIDTH) {
        sharpImg = sharpImg.resize({ width: MAX_WIDTH, withoutEnlargement: true });
      }

      let photoFilename, photoThumbFilename, finalMeta, photoSize, cloudinaryId;

      if (useCloudinary) {
        console.log(`☁️ Uploading to Cloudinary: ${file.originalname}...`);
        const buffer = await sharpImg.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream({ folder: 'album-apex' }, (error, res) => {
            if (error) {
              console.error('❌ Cloudinary Upload Error:', error.message);
              reject(error);
            } else {
              resolve(res);
            }
          }).end(buffer);
        });

        photoFilename = result.secure_url;
        // Generate thumbnail using Cloudinary transformations
        photoThumbFilename = result.secure_url.replace('/upload/', '/upload/w_400,h_400,c_fill,q_75/');
        finalMeta = { width: result.width, height: result.height };
        photoSize = result.bytes;
        cloudinaryId = result.public_id;
        console.log(`✅ Cloudinary Success: ${photoFilename}`);
      } else {
        await sharpImg.jpeg({ quality: 85, mozjpeg: true }).toFile(filepath);
        await sharp(file.buffer)
          .rotate()
          .resize({ width: 400, height: 400, fit: 'cover' })
          .jpeg({ quality: 75 })
          .toFile(thumbpath);

        finalMeta = await sharp(filepath).metadata();
        photoSize = fs.statSync(filepath).size;
      }

      const photo = {
        id,
        filename: photoFilename || filename,
        thumbFilename: photoThumbFilename || thumbFilename,
        cloudinaryId,
        originalName: file.originalname,
        categoryId: categoryId || null,
        width: finalMeta.width,
        height: finalMeta.height,
        size: photoSize,
        uploadedAt: new Date().toISOString()
      };

      db.photos = db.photos || [];
      db.photos.push(photo);
      uploaded.push(photo);
    } catch (err) {
      console.error('❌ Upload processing error:', file.originalname, err.message);
      // We continue with other files if one fails
    }
  }

  try {
    await writeDB(db);
    res.json(uploaded);
  } catch (e) {
    res.status(500).json({ error: "Failed to save database: " + e.message });
  }
});

app.put('/api/photos/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const idx = db.photos.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Photo non trouvée' });
    db.photos[idx] = { ...db.photos[idx], ...req.body, id: req.params.id };
    await writeDB(db);
    res.json(db.photos[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/photos/reorder', requireAuth, async (req, res) => {
  const { photoIds } = req.body;
  try {
    const db = await readDB();
    const photoMap = new Map(db.photos.map(p => [p.id, p]));
    const reordered = photoIds.map(id => photoMap.get(id)).filter(Boolean);
    const rest = db.photos.filter(p => !photoIds.includes(p.id));
    db.photos = [...reordered, ...rest];
    await writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function removePhoto(photo) {
  if (useCloudinary && photo.cloudinaryId) {
    try {
      await cloudinary.uploader.destroy(photo.cloudinaryId);
    } catch (e) {
      console.error('Failed to delete from Cloudinary:', e.message);
    }
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

    await removePhoto(photo);
    db.photos = db.photos.filter(p => p.id !== req.params.id);
    await writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/photos', requireAuth, async (req, res) => {
  const { ids } = req.body;
  try {
    const db = await readDB();
    const toDelete = db.photos.filter(p => ids.includes(p.id));
    await Promise.all(toDelete.map(p => removePhoto(p)));
    db.photos = db.photos.filter(p => !ids.includes(p.id));
    await writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Download routes ──────────────────────────────────────────────────────────
app.get('/api/download/:id', requireAuth, async (req, res) => {
  try {
    const db = await readDB();
    const photo = db.photos.find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo non trouvée' });

    if (photo.filename.startsWith('http')) {
      res.redirect(photo.filename.replace('/upload/', '/upload/fl_attachment/'));
    } else {
      const filepath = path.join(UPLOADS_DIR, photo.filename);
      if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier introuvable' });
      res.download(filepath, photo.originalName || photo.filename);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/download/bulk', requireAuth, async (req, res) => {
  const { ids } = req.body;
  try {
    const db = await readDB();
    const photos = db.photos.filter(p => ids.includes(p.id));
    if (photos.length === 0) return res.status(404).json({ error: 'Aucune photo trouvée' });

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
            if (response.statusCode === 200) resolve(response);
            else resolve(null);
          }).on('error', () => resolve(null));
        });
        if (stream) {
          archive.append(stream, { name: photo.originalName || photo.id + '.jpg' });
        }
      } else {
        const filepath = path.join(UPLOADS_DIR, photo.filename);
        if (fs.existsSync(filepath)) {
          archive.file(filepath, { name: photo.originalName || photo.filename });
        }
      }
    }
    archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ─── Catch-all: serve frontend ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Album Apex started on http://localhost:${PORT}`);
  console.log(`☁️  Cloudinary: ${useCloudinary ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📡 Supabase: ${supabase ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🔑 APP_PASSWORD: ${PASSWORD}`);
});
