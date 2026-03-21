/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Album Apex — Main Application Logic
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
    categories: [],
    photos: [],
    selectedPhotos: new Set(),
    activeFilter: 'all',
    lightboxIndex: -1,
    filteredPhotos: [],
    uploadQueue: []
};

// ── DOM Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
    const icons = {
        success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
        error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    };
    const t = el('div', `toast toast-${type}`);
    t.innerHTML = `${icons[type] || ''}<span>${message}</span>`;
    $('toast-container').prepend(t);
    setTimeout(() => {
        t.classList.add('removing');
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

// ── API ──────────────────────────────────────────────────────────────────────
async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body && !(body instanceof FormData)) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    } else if (body) {
        opts.body = body;
    }
    const res = await fetch(url, opts);
    if (res.status === 401) { showLoginScreen(); return null; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function showLoginScreen() {
    $('login-screen').classList.remove('hidden');
    $('app').classList.add('hidden');
}

function showApp(role = 'admin') {
    state.userRole = role;
    document.body.classList.remove('role-admin', 'role-viewer');
    document.body.classList.add(`role-${role}`);
    
    $('login-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
}

$('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('password-input').value;
    const btn = $('login-btn');
    const errEl = $('login-error');
    errEl.classList.add('hidden');
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-loading').classList.remove('hidden');
    btn.disabled = true;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        });
        const data = await res.json();
        if (res.ok) {
            showApp(data.role || 'admin');
            await loadAll();
        } else {
            errEl.classList.remove('hidden');
            $('password-input').value = '';
            $('password-input').focus();
        }
    } catch {
        errEl.classList.remove('hidden');
    } finally {
        btn.querySelector('.btn-text').classList.remove('hidden');
        btn.querySelector('.btn-loading').classList.add('hidden');
        btn.disabled = false;
    }
});

$('toggle-password').addEventListener('click', () => {
    const inp = $('password-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('logout-btn').addEventListener('click', async () => {
    await api('POST', '/api/logout');
    showLoginScreen();
});

// ── Navigation ────────────────────────────────────────────────────────────────
const views = ['gallery', 'upload', 'categories'];
function switchView(v) {
    views.forEach(id => {
        $(`view-${id}`).classList.toggle('active', id === v);
        $(`view-${id}`).classList.toggle('hidden', id !== v);
        $(`nav-${id}`).classList.toggle('active', id === v);
    });
    if (v === 'upload') populateUploadCategories();
    if (v === 'categories') renderCategories();
}

views.forEach(v => {
    $(`nav-${v}`).addEventListener('click', () => switchView(v));
});

// Sidebar collapse
let sidebarCollapsed = false;
$('sidebar-toggle').addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    $('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    $('main-content').classList.toggle('collapsed', sidebarCollapsed);
});

// ── Data Loading ──────────────────────────────────────────────────────────────
async function loadAll() {
    try {
        const [cats, photos] = await Promise.all([
            api('GET', '/api/categories'),
            api('GET', '/api/photos')
        ]);
        if (cats !== null) state.categories = cats;
        if (photos !== null) state.photos = photos;
        renderFilterBar();
        renderGallery();
    } catch (err) {
        toast('Erreur de chargement', 'error');
    }
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function getFilteredPhotos() {
    if (state.activeFilter === 'all') return state.photos;
    if (state.activeFilter === '__none__') return state.photos.filter(p => !p.categoryIds || p.categoryIds.length === 0);
    return state.photos.filter(p => (p.categoryIds || []).includes(state.activeFilter));
}

function renderFilterBar() {
    const bar = $('filter-bar').querySelector('.filter-scroll');
    // Keep "all" chip
    const allChip = bar.querySelector('[data-cat="all"]');
    bar.innerHTML = '';
    bar.appendChild(allChip);

    // "No category"
    const noneCount = state.photos.filter(p => !p.categoryIds || p.categoryIds.length === 0).length;
    if (noneCount > 0) {
        const chip = el('button', `filter-chip${state.activeFilter === '__none__' ? ' active' : ''}`);
        chip.dataset.cat = '__none__';
        chip.innerHTML = `<span class="chip-dot" style="background:#54566a"></span> Sans catégorie`;
        chip.addEventListener('click', () => setFilter('__none__'));
        bar.appendChild(chip);
    }

    state.categories.forEach(cat => {
        const count = state.photos.filter(p => (p.categoryIds || []).includes(cat.id)).length;
        const chip = el('button', `filter-chip${state.activeFilter === cat.id ? ' active' : ''}`);
        chip.dataset.cat = cat.id;
        chip.innerHTML = `<span class="chip-dot" style="background:${cat.color}"></span>${cat.name} <span style="opacity:.5;font-size:.75em">${count}</span>`;
        chip.addEventListener('click', () => setFilter(cat.id));
        bar.appendChild(chip);
    });

    allChip.classList.toggle('active', state.activeFilter === 'all');
}

function setFilter(f) {
    state.activeFilter = f;
    state.selectedPhotos.clear();
    renderFilterBar();
    renderGallery();
}

$('filter-all').addEventListener('click', () => setFilter('all'));

function renderGallery() {
    const grid = $('photo-grid');
    const filtered = getFilteredPhotos();
    state.filteredPhotos = filtered;

    // Clear non-empty-state items
    grid.querySelectorAll('.photo-card').forEach(c => c.remove());
    $('gallery-empty').classList.toggle('hidden', filtered.length > 0);

    const total = state.photos.length;
    $('gallery-count').textContent = `${total} photo${total !== 1 ? 's' : ''}${state.activeFilter !== 'all' ? ` · ${filtered.length} affichée${filtered.length !== 1 ? 's' : ''}` : ''}`;

    filtered.forEach((photo, idx) => {
        const card = createPhotoCard(photo, idx);
        grid.appendChild(card);
    });

    updateSelectionUI();
}

function createPhotoCard(photo, idx) {
    const photoCatIds = photo.categoryIds || (photo.categoryId ? [photo.categoryId] : []);
    const photoCats = photoCatIds.map(id => state.categories.find(c => c.id === id)).filter(Boolean);
    const isSelected = state.selectedPhotos.has(photo.id);
    const thumbSrc = (photo.thumbFilename || photo.filename).startsWith('http') ? (photo.thumbFilename || photo.filename) : `/uploads/${photo.thumbFilename || photo.filename}`;

    const card = el('div', `photo-card${isSelected ? ' selected' : ''}`);
    card.dataset.id = photo.id;
    card.dataset.idx = idx;

    let catBadges = '';
    photoCats.forEach((cat, i) => {
        catBadges += `<span class="photo-cat-badge" style="background:${cat.color}; right:${8 + (i * 12)}px" title="${escHtml(cat.name)}"></span>`;
    });

    card.innerHTML = `
    <img src="${thumbSrc}" alt="${escHtml(photo.originalName)}" loading="lazy" />
    <div class="photo-check">
      <svg class="photo-check-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    ${catBadges}
    <div class="photo-overlay">
      <span class="photo-name">${escHtml(photo.originalName)}</span>
      <div class="photo-actions-row">
        <button class="photo-action-btn" data-action="cat" title="Changer la catégorie" aria-label="Changer la catégorie">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"></path>
            <polygon points="18 2 22 6 12 16 8 16 8 12 18 2"></polygon>
          </svg>
        </button>
        <button class="photo-action-btn" data-action="download" title="Télécharger" aria-label="Télécharger">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button class="photo-action-btn danger" data-action="delete" title="Supprimer" aria-label="Supprimer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </div>
    </div>
  `;

    // Click: open lightbox (not on action buttons)
    card.addEventListener('click', e => {
        if (e.target.closest('[data-action]')) return;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            toggleSelect(photo.id);
        } else if (state.selectedPhotos.size > 0) {
            toggleSelect(photo.id);
        } else {
            openLightbox(idx);
        }
    });

    // Checkbox click area
    card.querySelector('.photo-check').addEventListener('click', e => {
        e.stopPropagation();
        toggleSelect(photo.id);
    });

    // Action buttons
    card.querySelector('[data-action="cat"]').addEventListener('click', e => {
        e.stopPropagation();
        openChangeCatModal([photo.id]);
    });
    card.querySelector('[data-action="download"]').addEventListener('click', e => {
        e.stopPropagation();
        downloadSingle(photo.id);
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', e => {
        e.stopPropagation();
        confirmDelete([photo.id], 'cette photo');
    });

    return card;
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Selection ─────────────────────────────────────────────────────────────────
function toggleSelect(id) {
    if (state.selectedPhotos.has(id)) state.selectedPhotos.delete(id);
    else state.selectedPhotos.add(id);
    updateSelectionUI();
    // Update card visual
    const card = document.querySelector(`.photo-card[data-id="${id}"]`);
    if (card) card.classList.toggle('selected', state.selectedPhotos.has(id));
}

function updateSelectionUI() {
    const count = state.selectedPhotos.size;
    const selActions = $('selection-actions');
    const selCount = $('selection-count');
    selActions.classList.toggle('hidden', count === 0);
    selCount.textContent = `${count} sélectionnée${count > 1 ? 's' : ''}`;
}

$('btn-clear-selection').addEventListener('click', () => {
    state.selectedPhotos.clear();
    document.querySelectorAll('.photo-card.selected').forEach(c => c.classList.remove('selected'));
    updateSelectionUI();
});

$('btn-select-all').addEventListener('click', () => {
    const filtered = getFilteredPhotos();
    const allSelected = filtered.every(p => state.selectedPhotos.has(p.id));
    if (allSelected) {
        filtered.forEach(p => state.selectedPhotos.delete(p.id));
    } else {
        filtered.forEach(p => state.selectedPhotos.add(p.id));
    }
    renderGallery();
});

// ── Download ──────────────────────────────────────────────────────────────────
function downloadSingle(id) {
    const link = document.createElement('a');
    link.href = `/api/download/${id}`;
    link.click();
}

async function downloadBulk(ids) {
    if (!ids.length) return;
    toast(`Préparation de ${ids.length} photo${ids.length > 1 ? 's' : ''}…`, 'info');
    try {
        const res = await fetch('/api/download/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `album-apex-${Date.now()}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        toast(`${ids.length} photo${ids.length > 1 ? 's' : ''} téléchargée${ids.length > 1 ? 's' : ''}`, 'success');
    } catch {
        toast('Erreur lors du téléchargement', 'error');
    }
}

$('btn-download-selected').addEventListener('click', () => {
    downloadBulk([...state.selectedPhotos]);
});

// ── Delete ────────────────────────────────────────────────────────────────────
function confirmDelete(ids, label = 'ces éléments') {
    $('confirm-title').textContent = 'Confirmer la suppression';
    $('confirm-message').textContent = `Voulez-vous supprimer ${label} de façon permanente ?`;
    $('confirm-modal').classList.remove('hidden');
    $('confirm-ok').onclick = async () => {
        $('confirm-modal').classList.add('hidden');
        await deletePhotos(ids);
    };
}

$('confirm-cancel').addEventListener('click', () => $('confirm-modal').classList.add('hidden'));
$('confirm-modal-overlay').addEventListener('click', () => $('confirm-modal').classList.add('hidden'));

async function deletePhotos(ids) {
    try {
        await api('DELETE', '/api/photos', { ids });
        ids.forEach(id => {
            state.photos = state.photos.filter(p => p.id !== id);
            state.selectedPhotos.delete(id);
        });
        renderFilterBar();
        renderGallery();
        toast(`${ids.length} photo${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}`, 'success');
    } catch {
        toast('Erreur de suppression', 'error');
    }
}

$('btn-delete-selected').addEventListener('click', () => {
    const ids = [...state.selectedPhotos];
    confirmDelete(ids, `${ids.length} photo${ids.length > 1 ? 's' : ''}`);
});

// ── Lightbox ──────────────────────────────────────────────────────────────────
function openLightbox(idx) {
    state.lightboxIndex = idx;
    updateLightbox();
    $('lightbox').classList.remove('hidden');
    document.addEventListener('keydown', lightboxKeyHandler);
}

function closeLightbox() {
    $('lightbox').classList.add('hidden');
    document.removeEventListener('keydown', lightboxKeyHandler);
    state.lightboxIndex = -1;
}

function updateLightbox() {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (!photo) return;
    $('lightbox-img').src = photo.filename.startsWith('http') ? photo.filename : `/uploads/${photo.filename}`;
    $('lightbox-img').alt = photo.originalName;
    $('lightbox-name').textContent = photo.originalName;
    $('lightbox-dims').textContent = photo.width && photo.height ? `${photo.width} × ${photo.height}px` : '';

    const cat = state.categories.find(c => c.id === photo.categoryId);
    const catEl = $('lightbox-cat');
    if (cat) {
        catEl.innerHTML = `<span class="chip-dot" style="background:${cat.color}"></span>${escHtml(cat.name)}`;
        catEl.classList.remove('hidden');
    } else {
        catEl.classList.add('hidden');
    }

    $('lightbox-prev').style.display = state.lightboxIndex <= 0 ? 'none' : 'flex';
    $('lightbox-next').style.display = state.lightboxIndex >= state.filteredPhotos.length - 1 ? 'none' : 'flex';
}

function lightboxKeyHandler(e) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
}

function lightboxNav(dir) {
    const newIdx = state.lightboxIndex + dir;
    if (newIdx >= 0 && newIdx < state.filteredPhotos.length) {
        state.lightboxIndex = newIdx;
        updateLightbox();
    }
}

$('lightbox-close').addEventListener('click', closeLightbox);
$('lightbox-overlay').addEventListener('click', closeLightbox);
$('lightbox-prev').addEventListener('click', () => lightboxNav(-1));
$('lightbox-next').addEventListener('click', () => lightboxNav(1));

$('lightbox-download').addEventListener('click', () => {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (photo) downloadSingle(photo.id);
});

$('lightbox-delete').addEventListener('click', () => {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (!photo) return;
    closeLightbox();
    confirmDelete([photo.id], `"${photo.originalName}"`);
});

// Touch/swipe on lightbox
let touchStartX = 0;
$('lightbox').addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
$('lightbox').addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) lightboxNav(dx < 0 ? 1 : -1);
});

// ── Upload ────────────────────────────────────────────────────────────────────
function populateUploadCategories() {
    const container = $('upload-categories-list');
    container.innerHTML = '';
    state.categories.forEach(cat => {
        const item = el('label', 'checkbox-item');
        item.innerHTML = `
            <input type="checkbox" name="upload-cats" value="${cat.id}">
            <span class="checkbox-box"></span>
            <span class="checkbox-label">${escHtml(cat.name)}</span>
        `;
        container.appendChild(item);
    });
}

// File Queue
state.uploadQueue = [];

function addFilesToQueue(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/') && !/\.(jpg|jpeg|png|gif|webp|heic|avif)$/i.test(file.name)) return;
        const existing = state.uploadQueue.find(q => q.file.name === file.name && q.file.size === file.size);
        if (existing) return;
        const item = { file, id: Math.random().toString(36).slice(2), status: 'pending' };
        state.uploadQueue.push(item);
        renderQueueItem(item);
    });
    const hasItems = state.uploadQueue.length > 0;
    $('upload-queue').classList.toggle('hidden', !hasItems);
    $('upload-actions').classList.toggle('hidden', !hasItems);
}

function renderQueueItem(item) {
    const queue = $('upload-queue');
    const existing = queue.querySelector(`[data-qid="${item.id}"]`);
    if (existing) { updateQueueItemStatus(item); return; }

    const div = el('div', 'queue-item');
    div.dataset.qid = item.id;

    // Thumbnail preview
    const thumb = el('img', 'queue-thumb');
    thumb.alt = item.file.name;
    const reader = new FileReader();
    reader.onload = e => { thumb.src = e.target.result; };
    reader.readAsDataURL(item.file);

    const info = el('div', 'queue-info');
    info.innerHTML = `<div class="queue-name">${escHtml(item.file.name)}</div><div class="queue-size">${formatBytes(item.file.size)}</div>`;

    const status = el('div', 'queue-status pending');
    status.dataset.status = item.id;
    status.textContent = 'En attente';

    const removeBtn = el('button', 'queue-remove', `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`);
    removeBtn.title = 'Retirer';
    removeBtn.addEventListener('click', () => {
        state.uploadQueue = state.uploadQueue.filter(q => q.id !== item.id);
        div.remove();
        const hasItems = state.uploadQueue.length > 0;
        $('upload-queue').classList.toggle('hidden', !hasItems);
        $('upload-actions').classList.toggle('hidden', !hasItems);
    });

    div.append(thumb, info, status, removeBtn);
    queue.appendChild(div);
}

function updateQueueItemStatus(item) {
    const el = document.querySelector(`[data-status="${item.id}"]`);
    if (!el) return;
    const icons = {
        pending: '', uploading: '<svg class="spinner-sm" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(99,102,241,0.3);border-top-color:#6366f1;border-radius:50%;animation:spin .7s linear infinite"></svg> ',
        done: '✓ ', error: '✗ '
    };
    el.className = `queue-status ${item.status}`;
    el.innerHTML = `${icons[item.status] || ''}${item.status === 'pending' ? 'En attente' :
        item.status === 'uploading' ? 'Upload…' :
            item.status === 'done' ? 'OK' : 'Erreur'
        }`;
    // Hide remove button when done
    const row = el.closest('.queue-item');
    if (row && item.status === 'done') row.querySelector('.queue-remove').style.display = 'none';
}

function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// Drop Zone
const dropZone = $('drop-zone');
const fileInput = $('file-input');

dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); });
dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFilesToQueue(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => { addFilesToQueue(fileInput.files); fileInput.value = ''; });

$('btn-clear-queue').addEventListener('click', () => {
    state.uploadQueue = [];
    $('upload-queue').innerHTML = '';
    $('upload-queue').classList.add('hidden');
    $('upload-actions').classList.add('hidden');
});

$('btn-upload').addEventListener('click', async () => {
    const pending = state.uploadQueue.filter(q => q.status === 'pending');
    if (!pending.length) return;

    const checked = Array.from(document.querySelectorAll('input[name="upload-cats"]:checked')).map(i => i.value);
    const btn = $('btn-upload');
    btn.disabled = true;

    // Upload in batches of 10
    const batchSize = 10;
    for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        const fd = new FormData();
        checked.forEach(id => fd.append('categoryIds', id));
        batch.forEach(item => {
            item.status = 'uploading';
            updateQueueItemStatus(item);
            fd.append('photos', item.file);
        });

        try {
            const res = await fetch('/api/photos/upload', { method: 'POST', body: fd });
            const uploaded = await res.json();
            batch.forEach(item => {
                item.status = 'done';
                updateQueueItemStatus(item);
            });
            if (Array.isArray(uploaded)) {
                state.photos.push(...uploaded);
            }
        } catch {
            batch.forEach(item => {
                item.status = 'error';
                updateQueueItemStatus(item);
            });
            toast('Erreur lors de l\'upload', 'error');
        }
    }

    const successCount = state.uploadQueue.filter(q => q.status === 'done').length;
    toast(`${successCount} photo${successCount > 1 ? 's' : ''} uploadée${successCount > 1 ? 's' : ''} avec succès !`, 'success');
    btn.disabled = false;

    // After upload, refresh and switch to gallery
    await loadAll();
    setTimeout(() => {
        state.uploadQueue = [];
        $('upload-queue').innerHTML = '';
        $('upload-queue').classList.add('hidden');
        $('upload-actions').classList.add('hidden');
        switchView('gallery');
    }, 1200);
});

// ── Categories ────────────────────────────────────────────────────────────────
function renderCategories() {
    const grid = $('categories-grid');
    grid.querySelectorAll('.cat-card').forEach(c => c.remove());
    $('categories-empty').classList.toggle('hidden', state.categories.length > 0);
    $('cat-count').textContent = `${state.categories.length} catégorie${state.categories.length !== 1 ? 's' : ''}`;

    state.categories.forEach(cat => {
        const count = state.photos.filter(p => p.categoryId === cat.id).length;
        const card = el('div', 'cat-card');
        card.innerHTML = `
      <div class="cat-icon" style="background:${cat.color}22; color:${cat.color}">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
      </div>
      <div class="cat-info">
        <div class="cat-name">${escHtml(cat.name)}</div>
        <div class="cat-count">${count} photo${count !== 1 ? 's' : ''}</div>
      </div>
      <div class="cat-actions">
        <button class="cat-action-btn" data-action="edit" title="Modifier" aria-label="Modifier ${escHtml(cat.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="cat-action-btn danger" data-action="delete" title="Supprimer" aria-label="Supprimer ${escHtml(cat.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </div>
    `;

        card.querySelector('[data-action="edit"]').addEventListener('click', () => openCatModal(cat));
        card.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDeleteCategory(cat));
        grid.appendChild(card);
    });
}

function confirmDeleteCategory(cat) {
    const count = state.photos.filter(p => p.categoryId === cat.id).length;
    $('confirm-title').textContent = 'Supprimer la catégorie';
    $('confirm-message').textContent = `Supprimer "${cat.name}" ?${count > 0 ? ` Les ${count} photo${count > 1 ? 's' : ''} seront désassociées.` : ''}`;
    $('confirm-modal').classList.remove('hidden');
    $('confirm-ok').onclick = async () => {
        $('confirm-modal').classList.add('hidden');
        try {
            await api('DELETE', `/api/categories/${cat.id}`);
            state.categories = state.categories.filter(c => c.id !== cat.id);
            state.photos = state.photos.map(p => ({ ...p, categoryId: p.categoryId === cat.id ? null : p.categoryId }));
            renderCategories();
            renderFilterBar();
            if (state.activeFilter === cat.id) setFilter('all');
            toast('Catégorie supprimée', 'success');
        } catch {
            toast('Erreur de suppression', 'error');
        }
    };
}

// ── Category Modal ────────────────────────────────────────────────────────────
let selectedColor = '#6366f1';

function openCatModal(cat = null) {
    $('cat-modal-title').textContent = cat ? 'Modifier la catégorie' : 'Nouvelle catégorie';
    $('cat-save-btn').textContent = cat ? 'Enregistrer' : 'Créer';
    $('cat-id').value = cat ? cat.id : '';
    $('cat-name').value = cat ? cat.name : '';
    selectedColor = cat ? cat.color : '#6366f1';
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === selectedColor);
    });
    $('cat-modal').classList.remove('hidden');
    setTimeout(() => $('cat-name').focus(), 50);
}

$('btn-new-category').addEventListener('click', () => openCatModal());
$('cat-modal-close').addEventListener('click', () => $('cat-modal').classList.add('hidden'));
$('cat-cancel-btn').addEventListener('click', () => $('cat-modal').classList.add('hidden'));
$('cat-modal-overlay').addEventListener('click', () => $('cat-modal').classList.add('hidden'));

document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        selectedColor = swatch.dataset.color;
    });
});

$('cat-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('cat-name').value.trim();
    const id = $('cat-id').value;
    if (!name) return;

    try {
        if (id) {
            const updated = await api('PUT', `/api/categories/${id}`, { name, color: selectedColor });
            if (updated) {
                state.categories = state.categories.map(c => c.id === id ? updated : c);
                toast('Catégorie modifiée', 'success');
            }
        } else {
            const created = await api('POST', '/api/categories', { name, color: selectedColor });
            if (created) {
                state.categories.push(created);
                toast('Catégorie créée', 'success');
            }
        }
        $('cat-modal').classList.add('hidden');
        renderCategories();
        renderFilterBar();
    } catch (err) {
        toast(err.message || 'Erreur', 'error');
    }
});

// ── Change Category ───────────────────────────────────────────────────────────
let targetPhotosToChangeCat = [];

function openChangeCatModal(photoIds) {
    targetPhotosToChangeCat = photoIds;
    const container = $('change-cat-list');
    container.innerHTML = '';
    
    let currentIds = [];
    if (photoIds.length === 1) {
        const photo = state.photos.find(p => p.id === photoIds[0]);
        currentIds = photo.categoryIds || (photo.categoryId ? [photo.categoryId] : []);
        $('change-cat-title').textContent = 'Modifier les catégories';
    } else {
        $('change-cat-title').textContent = `Modifier ${photoIds.length} photos`;
    }

    state.categories.forEach(cat => {
        const item = el('label', 'checkbox-item');
        const checked = currentIds.includes(cat.id);
        item.innerHTML = `
            <input type="checkbox" name="change-cats" value="${cat.id}" ${checked ? 'checked' : ''}>
            <span class="checkbox-box"></span>
            <span class="checkbox-label">${escHtml(cat.name)}</span>
        `;
        container.appendChild(item);
    });

    $('change-cat-modal').classList.remove('hidden');
}

function closeChangeCatModal() {
    $('change-cat-modal').classList.add('hidden');
    targetPhotosToChangeCat = [];
}

$('change-cat-close').addEventListener('click', closeChangeCatModal);
$('change-cat-cancel').addEventListener('click', closeChangeCatModal);
$('change-cat-modal-overlay').addEventListener('click', closeChangeCatModal);

$('change-cat-save').addEventListener('click', async () => {
    const newCatIds = Array.from(document.querySelectorAll('input[name="change-cats"]:checked')).map(i => i.value);
    const ids = targetPhotosToChangeCat;
    if (!ids.length) return;

    const btn = $('change-cat-save');
    btn.disabled = true;
    btn.textContent = 'En cours...';

    try {
        await Promise.all(ids.map(id => api('PUT', `/api/photos/${id}`, { categoryIds: newCatIds, categoryId: newCatIds[0] || null })));

        ids.forEach(id => {
            const idx = state.photos.findIndex(p => p.id === id);
            if (idx !== -1) {
                state.photos[idx].categoryIds = newCatIds;
                state.photos[idx].categoryId = newCatIds[0] || null;
            }
        });

        toast(`${ids.length} photo${ids.length > 1 ? 's' : ''} déplacée${ids.length > 1 ? 's' : ''}`, 'success');
        closeChangeCatModal();
        renderFilterBar();
        renderGallery();
        if (!$('lightbox').classList.contains('hidden')) {
            updateLightbox();
        }
    } catch (err) {
        toast('Erreur lors du déplacement', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Déplacer';
    }
});

$('btn-change-cat-selected').addEventListener('click', () => {
    openChangeCatModal([...state.selectedPhotos]);
});

$('lightbox-change-cat').addEventListener('click', () => {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (photo) openChangeCatModal([photo.id]);
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
    try {
        const auth = await fetch('/api/auth/check').then(r => r.json());
        if (auth.authenticated) {
            showApp(auth.role || 'admin');
            await loadAll();
        }
        // else: login screen is already shown by default
    } catch {
        // Server might be starting, show login screen
    }
})();
