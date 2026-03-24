# Album Apex 📸

Album Apex est une plateforme d'échange de photos privée, pensée pour la simplicité et la rapidité. Conçue pour permettre un partage sécurisé, elle intègre un système de catégories, le glisser-déposer, ainsi que le téléchargement groupé.

## Fonctionnalités ✨

- 🔒 **Accès sécurisé à double niveau** – Un mot de passe administrateur (gestion complète : ajout, suppression, catégories) et un mot de passe spectateur (consultation et téléchargement uniquement).
- 🗂️ **Gestion par catégories** — Créez, modifiez et attribuez des catégories avec des couleurs personnalisées.
- 📤 **Upload drag-and-drop** — Glissez-déposez jusqu'à 50 photos simultanément.
- 🖼️ **Optimisation automatique** — Le poids des images est réduit et redimensionné (1920px de large maximum) à la volée.
- 🔍 **Filtre et tri faciles** — Naviguez dans votre galerie photo selon les catégories très facilement.
- ✅ **Sélection multiple** — Pratique pour modifier les catégories en lot, supprimer ou télécharger de multiples fichiers.
- 📦 **Téléchargement groupé** — Récupérez une sélection entière sous la forme d'un seul fichier `.zip`.
- 🔭 **Visionneuse (Lightbox)** — Mode plein écran avec navigation au clavier et support du glissement (swipe) sur mobile.
- ☁️ **Hébergement des photos (Recommandé)** — Intégration native et optimisée avec **Cloudinary**, un service externe gratuit et très pratique pour stocker vos photos de façon permanente (sans saturer votre propre serveur !), couplé à **Supabase** pour la base de données. Note : si non configurés, l'application bascule automatiquement sur un hébergement local.

## Installation Locale 💻

### Prérequis

- **Node.js** (version 18.0.0 ou supérieure)
- **npm** (inclus par défaut avec Node.js)

### Étapes d'installation

1. **Cloner ou télécharger le dépôt** de l'application sur votre machine.
2. Ouvrez un terminal pointant vers le dossier du projet.
3. Installez les dépendances :
   ```bash
   npm install
   ```
4. Démarrez le serveur :
   ```bash
   npm start
   ```
5. Accédez à l'application depuis votre navigateur à l'adresse : `http://localhost:3000`

*(Pour le développement, vous pouvez utiliser `npm run dev` pour profiter du rechargement automatique avec nodemon).*

## Configuration (Variables d'environnement) ⚙️

Pour sécuriser et paramétrer votre instance, il est recommandé de créer un fichier `.env` à la racine de votre projet. Voici les variables que vous pouvez configurer :

| Variable | Description | Exemple / Défaut |
|----------|-------------|------------------|
| `PORT` | Port d'écoute du serveur | `3000` |
| `APP_PASSWORD` | Mot de passe Administrateur (accès complet) | `votre-mot-de-passe-admin` |
| `VIEWER_PASSWORD` | Mot de passe Spectateur (lecture seule) | `votre-mot-de-passe-visiteur` |
| `SESSION_SECRET` | Clé secrète de cryptage pour les identifiants | `une-cle-secrete-aleatoire` |

**Variables pour le Cloud (Optionnel) :**
| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | L'URL de votre projet Supabase (Stockage des informations) |
| `SUPABASE_KEY` | La clé d'API (Anon/Service) de Supabase |
| `CLOUDINARY_CLOUD_NAME` | Nom du cloud Cloudinary (Traitement et hébergement des images) |
| `CLOUDINARY_API_KEY` | Clé d'API Cloudinary |
| `CLOUDINARY_API_SECRET`| Secret d'API Cloudinary |

## Déploiement Exemple (ex: Render.com) 🚀

1. Poussez votre code sur GitHub.
2. Créez un nouveau **Web Service** chez votre hébergeur (ex: [Render](https://render.com)).
3. Paramètres de compilation et de démarrage :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Ajoutez vos **Variables d'environnement** (le mot de passe admin, visiteur, etc.) dans l'interface de votre hébergeur.
5. Déployez !

> ⚠️ **Note importante sur le stockage** : Chez de nombreux hébergeurs gratuits (comme Render *free tier*), le stockage local principal est temporaire et **éphémère**. Vos photos risqueraient d'être supprimées à chaque redémarrage du serveur. C'est exactement pour cela que nous utilisons et recommandons **Cloudinary** : c'est un service d'hébergement d'images gratuit très pratique qui garantit la pérennité de votre galerie photo. Pour en bénéficier en production, il vous suffit de renseigner les variables `CLOUDINARY_*` et `SUPABASE_*` décrites ci-dessus.

## Stack Technique 🛠️

- **Backend** : Node.js, Express
- **Stockage & BDD** : Supabase, Cloudinary ou fallback local (JSON et système de fichiers)
- **Traitement image** : Sharp (redimensionnement intelligent)
- **Archive** : Archiver (création de paquets ZIP à la volée)
- **Frontend** : HTML5, CSS3, JavaScript Vanilla (sans framework externe, léger et rapide)
