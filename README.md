# Éclat Ai

Application web (style mobile, néon rose) pour créer des **images** et des **vidéos** avec l'IA, et discuter avec un **Agent IA** créatif.
Ouvrez `index.html` (ou publiez le dépôt sur GitHub Pages), puis **Profil → Paramètres de l'IA** pour coller votre clé Agnes.

| Fonction | Moteur | Vitesse (mesurée) |
| --- | --- | --- |
| Agent IA | Agnes `agnes-3.0-flash` | 1 à 10 s |
| Image, Image → Image | Agnes `agnes-image-2.5-flash` / `2.1-flash` (secours : Pollinations gratuit) | ~11 s |
| Vidéo IA | Agnes `agnes-video-2.5-flash` (file souvent pleine : l'app réessaie toutes les 30 s) | variable |
| Vidéo — repli automatique | Montage animé dans le navigateur à partir d'images Agnes (caméra, transitions, musique) | ~2 min pour 10 s |

Sans clé Agnes, tout fonctionne avec Pollinations (1 image / 45 s).

Fichiers : `index.html` (écrans), `css/app.css` (style), `js/engine.js` (moteurs), `js/app.js` (interface), `assets/` (visuels générés avec Agnes).

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
