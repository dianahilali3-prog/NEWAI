# DianaLuxe AI

Générateur d'images et de vidéos IA gratuit. Trois moteurs vidéo en cascade :

| Moteur | Ce que ça donne | Coût / limite |
| --- | --- | --- |
| **Agnes AI** (via le serveur) | Vraie vidéo IA, haute qualité | Clé gratuite sur platform.agnes-ai.com · 1 vidéo/min/clé (le serveur fait la file et réessaie quand c'est saturé) |
| **LTX-Video / Wan 2.1** (open-source, sur GPU) | Vraie vidéo IA | Gratuit et sans limite sur votre GPU, ou GPU gratuit Colab/Kaggle |
| **Montage local** (dans le navigateur) | Images IA Pollinations animées, transitions, musique | Gratuit, sans rien installer · Pollinations gratuit = 1 image / 45 s (géré automatiquement, 2-3 plans par image) |

Si un moteur est saturé ou indisponible, le suivant prend le relais automatiquement.

## 1. Le site (`index.html`)
Ouvrez `index.html` (ou publiez-le sur GitHub Pages). Sans rien configurer, le montage local fonctionne déjà.

## 2. Activer la vraie vidéo IA (gratuit)
1. Ouvrez `notebooks/DianaLuxe_GPU.ipynb` dans **Google Colab** (GPU T4) ou **Kaggle** (GPU T4, Internet activé).
2. (Optionnel) Collez une ou plusieurs clés Agnes, séparées par des virgules.
3. Exécutez les cellules : le notebook affiche une **adresse** `https://….trycloudflare.com` et un **jeton**.
4. Dans le site : **⚙️ Serveur IA vidéo** → collez l'adresse et le jeton → **Tester la connexion**.

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
