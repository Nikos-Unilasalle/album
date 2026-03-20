# Album Apex 📸

Plateforme d'échange de photos privée avec catégories, glisser-déposer et téléchargement groupé.

## Fonctionnalités

- 🔒 **Accès par mot de passe** (configurable via variable d'environnement)
- 🗂️ **Catégories** — créez et gérez des catégories avec couleurs personnalisées
- 📤 **Upload drag-and-drop** — glissez jusqu'à 50 photos à la fois
- 🖼️ **Redimensionnement automatique** — toutes les images sont redimensionnées à 1920px de large maximum
- 🔍 **Filtre par catégorie** — activez/désactivez des catégories pour filtrer la galerie
- ✅ **Sélection multiple** — sélectionnez plusieurs photos pour les télécharger ou supprimer
- 📦 **Téléchargement groupé** — téléchargez une sélection en un seul fichier ZIP
- 🔭 **Visionneuse** — lightbox avec navigation clavier et swipe mobile

## Démarrage local

```bash
npm install
npm start
```

Ouvrez `http://localhost:3000`

Mot de passe par défaut : `apex2024`

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `APP_PASSWORD` | Mot de passe d'accès | `apex2024` |
| `SESSION_SECRET` | Clé secrète des sessions | `apex-secret-key-2024` |
| `PORT` | Port du serveur | `3000` |

## Déploiement sur Render.com

1. Poussez ce dépôt sur GitHub
2. Créez un nouveau **Web Service** sur [render.com](https://render.com)
3. Connectez votre dépôt GitHub
4. Configurez :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Environment** : Node
5. Ajoutez les variables d'environnement :
   - `APP_PASSWORD` → votre mot de passe souhaité
   - `SESSION_SECRET` → une clé aléatoire longue
6. Cliquez **Deploy**

> ⚠️ **Note** : Sur Render.com free tier, le système de fichiers est **éphémère**. Les photos uploadées seront perdues à chaque redémarrage. Pour une solution persistante, il faudrait intégrer un service de stockage comme AWS S3 ou Cloudinary.

## Stack technique

- **Backend** : Node.js + Express
- **Traitement image** : Sharp (resize + thumbnails)
- **Auth** : express-session
- **Archive** : Archiver (ZIP)
- **Frontend** : HTML5 + CSS3 + JavaScript vanilla
