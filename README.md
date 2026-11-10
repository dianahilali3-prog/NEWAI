# Éclat Ai

Application web (style mobile, néon rose) pour créer des **images** et des **vidéos** avec l'IA, et discuter avec un **Agent IA** créatif.
Ouvrez `index.html` (ou publiez le dépôt sur GitHub Pages), puis **Profil → Paramètres de l'IA** pour coller votre clé Agnes.

| Fonction | Moteur | Vitesse (mesurée) |
| --- | --- | --- |
| Agent IA connecté au web | Agnes `agnes-3.0-flash` + outils : recherche web (Yahoo via Jina Reader, Wikipédia), lecture de pages, photos libres (Wikimedia Commons), créations, personnages ; voit les photos envoyées | ~1 min pour recherche + 3 pages lues + 3 images |
| Image, Image → Image | Agnes `agnes-image-2.5-flash` / `2.1-flash` (secours : Pollinations gratuit) | ~11 s |
| Image open source | **Qwen-Image 2512** et **Qwen-Image-Edit 2511** (Alibaba, Apache 2.0) sur les Spaces officiels Hugging Face (GPU gratuits, quota par personne : ajouter un token Hugging Face gratuit) ; repli automatique sur Agnes puis Pollinations | selon la file Hugging Face |
| Studio en lot | Jusqu'à 30 images et vidéos, chacune son prompt, en parallèle | 4 images en 16 s ; 6 créations mixtes en 1 min 44 |
| Personnages | Photo de référence + description, même visage via Agnes image → image | ~11 s par image |
| Vidéo IA | Agnes `agnes-video-2.5-flash` (file souvent pleine : l'app réessaie) | variable |
| Vidéo — repli automatique | Montage animé dans le navigateur à partir d'images Agnes créées en parallèle | ~40 s pour 10 s |

Nano Banana 2 (Google, `gemini-3.1-flash-image`) n'est pas open source et n'a pas d'offre gratuite officielle (payant chez Google et Cloudflare) : il n'est pas intégré.

Sans clé Agnes, tout fonctionne avec Pollinations (1 image / 45 s).

**Installable** sur téléphone (« Sur l'écran d'accueil ») une fois publié en HTTPS (ex. GitHub Pages) ; l'interface s'ouvre même hors ligne.

La liste des projets open source qui peuvent renforcer l'app est dans **Profil → Open source & boosters**.

Fichiers : `index.html` (écrans), `css/app.css` (style), `js/engine.js` (moteurs), `js/app.js` (interface), `assets/` (visuels générés avec Agnes), `manifest.webmanifest` + `sw.js` (application installable).

---

## Serveur GPU optionnel

1. Ouvrez `notebooks/DianaLuxe_GPU.ipynb` dans **Google Colab** (GPU T4) ou **Kaggle** (GPU T4, Internet activé).
2. (Optionnel) Collez une ou plusieurs clés Agnes, séparées par des virgules.
3. Exécutez les cellules : le notebook affiche une **adresse** `https://….trycloudflare.com` et un **jeton**.
4. Dans l'app : **Profil → Paramètres de l'IA** → collez l'adresse et le jeton → **Enregistrer et tester**.

Astuce : `index.html#server=ADRESSE&token=JETON` remplit les champs automatiquement.

## 3. Lancer le serveur sur votre propre PC (illimité)
Avec une carte NVIDIA (8 Go+ conseillés) :
```bash
cd server
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
AGNES_API_KEYS=cle1,cle2 DIANALUXE_TOKEN=monjeton uvicorn app:app --host 0.0.0.0 --port 8000
```
Puis dans le site : adresse `http://localhost:8000`.

### Variables du serveur
| Variable | Rôle | Défaut |
| --- | --- | --- |
| `AGNES_API_KEYS` | Clés Agnes (rotation) | aucune |
| `DIANALUXE_BACKENDS` | Ordre des moteurs (`agnes,local,mock`) | auto |
| `LOCAL_MODEL` | `ltx` (rapide) ou `wan` (Wan 2.1 1.3B) | `ltx` |
| `LOCAL_MAX_SIDE` | Résolution max du moteur local | `768` |
| `DIANALUXE_TOKEN` | Jeton demandé aux clients | aucun |
| `AGNES_MIN_INTERVAL` | Secondes entre deux demandes par clé | `62` |
| `AGNES_MODELS` | Modèles vidéo essayés dans l'ordre | `agnes-video-2.5-flash,agnes-video-2.5,agnes-video-v2.0` |

### API (compatible Agnes)
- `POST /v1/videos` `{prompt, width, height, num_frames, frame_rate, seed?, image?}` → `{video_id}`
- `GET /agnesapi?video_id=…` → `{status, progress, queue_position, backend, url}`
- `GET /health`

### Tests
```bash
cd server && python3 tests/test_server.py   # faux Agnes saturé + cascade
```
