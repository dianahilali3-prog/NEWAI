"""
DianaLuxe Video Server
======================

Serveur de génération vidéo IA compatible avec l'API Agnes
(POST /v1/videos  +  GET /agnesapi?video_id=...).

Cascade de moteurs (dans l'ordre de DIANALUXE_BACKENDS) :
  - agnes : API officielle Agnes AI (clé gratuite sur platform.agnes-ai.com).
            Plusieurs clés possibles (rotation). Respect de la limite
            1 vidéo/minute/clé + nouvelle tentative automatique si saturé.
  - local : modèle open-source sur votre GPU (LTX-Video ou Wan 2.1),
            aucune limite, aucun compte.
  - mock  : fausse vidéo de test (aucun GPU nécessaire).

Lancement :
    pip install -r requirements.txt
    AGNES_API_KEYS=cle1,cle2 uvicorn app:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import random
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

log = logging.getLogger("dianaluxe")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ─────────────────────────────────────────────────────────────────
# Configuration (variables d'environnement)
# ─────────────────────────────────────────────────────────────────
OUTPUT_DIR = Path(os.environ.get("DIANALUXE_OUTPUT_DIR", Path(__file__).parent / "outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SERVER_TOKEN = os.environ.get("DIANALUXE_TOKEN", "").strip()          # vide = pas de protection
AGNES_KEYS = [k.strip() for k in os.environ.get("AGNES_API_KEYS", os.environ.get("AGNES_API_KEY", "")).split(",") if k.strip()]
AGNES_BASE = os.environ.get("AGNES_BASE_URL", "https://apihub.agnes-ai.com").rstrip("/")
# Modèles vidéo réellement listés par /v1/models (novembre 2026) ; essayés dans l'ordre.
AGNES_MODELS = [m.strip() for m in os.environ.get("AGNES_MODELS", "agnes-video-2.5-flash,agnes-video-2.5,agnes-video-v2.0").split(",") if m.strip()]
AGNES_MIN_INTERVAL = float(os.environ.get("AGNES_MIN_INTERVAL", "62"))   # secondes entre 2 créations par clé
AGNES_MAX_WAIT = float(os.environ.get("AGNES_MAX_WAIT", "2400"))         # temps max passé à attendre Agnes avant le moteur suivant
AGNES_QUEUE_RETRY = float(os.environ.get("AGNES_QUEUE_RETRY", "30"))     # intervalle entre deux essais quand la file Agnes est pleine
LOCAL_MODEL = os.environ.get("LOCAL_MODEL", "ltx").lower()               # ltx | wan
LOCAL_MAX_SIDE = int(os.environ.get("LOCAL_MAX_SIDE", "768"))            # résolution max du moteur local (augmentez si gros GPU)
KEEP_FILES = int(os.environ.get("DIANALUXE_KEEP_FILES", "200"))


def _default_backends() -> list[str]:
    order = []
    if AGNES_KEYS:
        order.append("agnes")
    try:
        import torch  # noqa: F401
        if torch.cuda.is_available():
            order.append("local")
    except Exception:
        pass
    return order


BACKENDS = [b.strip() for b in os.environ.get("DIANALUXE_BACKENDS", "").split(",") if b.strip()] or _default_backends()

RETRYABLE = {408, 409, 429, 500, 502, 503, 504, 520, 522, 524}


# ─────────────────────────────────────────────────────────────────
# Modèles de données
# ─────────────────────────────────────────────────────────────────
class VideoRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=4000)
    negative_prompt: Optional[str] = None
    model: Optional[str] = None                     # ignoré (compatibilité Agnes)
    width: int = Field(768, ge=256, le=1920)
    height: int = Field(1152, ge=256, le=1920)
    num_frames: int = Field(121, ge=9, le=481)
    frame_rate: int = Field(24, ge=8, le=60)
    seed: Optional[int] = None
    steps: Optional[int] = Field(None, ge=1, le=100)
    image: Optional[str] = None                     # data URL / base64 : première image (image → vidéo, moteur local)
    backends: Optional[list[str]] = None            # forcer un ordre de moteurs


class Job:
    def __init__(self, req: VideoRequest):
        self.id = "dl_" + uuid.uuid4().hex[:16]
        self.req = req
        self.status = "queued"         # queued | running | completed | failed
        self.progress = 0.0
        self.message = "En file d'attente"
        self.backend: Optional[str] = None
        self.file: Optional[Path] = None
        self.remote_url: Optional[str] = None
        self.error: Optional[str] = None
        self.attempts: list[str] = []
        self.created = time.time()
        self.finished: Optional[float] = None

    def public(self, base_url: str) -> dict[str, Any]:
        url = f"{base_url}files/{self.file.name}" if self.file else self.remote_url
        position = None
        if self.status == "queued":
            position = sum(1 for j in QUEUE_ORDER if JOBS.get(j) and JOBS[j].status == "queued" and JOBS[j].created <= self.created)
        return {
            "video_id": self.id, "id": self.id, "status": self.status,
            "progress": round(self.progress, 3), "message": self.message,
            "queue_position": position, "backend": self.backend,
            "url": url, "video_url": url, "error": self.error, "attempts": self.attempts,
            "created_at": int(self.created),
        }


JOBS: dict[str, Job] = {}
QUEUE_ORDER: list[str] = []
queue: "asyncio.Queue[str]"


# ─────────────────────────────────────────────────────────────────
# Moteur 1 : Agnes AI (avec rotation de clés et gestion de la saturation)
# ─────────────────────────────────────────────────────────────────
class AgnesKeyPool:
    """Distribue les clés en respectant 1 création / minute / clé."""

    def __init__(self, keys: list[str]):
        self.keys = keys
        self.next_ok = {k: 0.0 for k in keys}
        self.lock = asyncio.Lock()

    async def acquire(self, deadline: float) -> Optional[str]:
        while time.time() < deadline:
            async with self.lock:
                now = time.time()
                key = min(self.keys, key=lambda k: self.next_ok[k])
                wait = self.next_ok[key] - now
                if wait <= 0:
                    self.next_ok[key] = now + AGNES_MIN_INTERVAL
                    return key
            await asyncio.sleep(min(wait, 5))
        return None

    def penalize(self, key: str, seconds: float) -> None:
        self.next_ok[key] = max(self.next_ok[key], time.time() + seconds)


agnes_pool = AgnesKeyPool(AGNES_KEYS) if AGNES_KEYS else None


def _find_video_url(data: Any) -> Optional[str]:
    """Cherche l'URL de la vidéo quel que soit le format de réponse."""
    if isinstance(data, str):
        return data if data.startswith("http") and any(x in data.lower() for x in (".mp4", ".webm", ".mov", "video")) else None
    if isinstance(data, dict):
        for k in ("url", "video_url", "videoUrl", "output", "result", "download_url", "file_url"):
            v = data.get(k)
            if isinstance(v, str) and v.startswith("http"):
                return v
        for v in data.values():
            u = _find_video_url(v)
            if u:
                return u
    if isinstance(data, list):
        for v in data:
            u = _find_video_url(v)
            if u:
                return u
    return None


def _agnes_size(w: int, h: int) -> tuple[int, int]:
    # Tailles multiples de 32 proches de la demande (format de l'exemple officiel : 1152x768).
    def r(x: int) -> int:
        return max(256, min(1280, int(round(x / 32)) * 32))
    return r(w), r(h)


async def run_agnes(job: Job) -> None:
    if not agnes_pool:
        raise RuntimeError("aucune clé AGNES_API_KEYS configurée")
    req = job.req
    w, h = _agnes_size(req.width, req.height)
    secs = max(1.0, req.num_frames / max(1, req.frame_rate))
    # Deux formats de requête existent selon le modèle (constatés en direct, novembre 2026) :
    #  - "simple" (agnes-video-2.5 / 2.5-flash) : mode, seconds, size  — width/num_frames y sont interdits
    #  - "frames" (agnes-video-v2.0, doc officielle) : width, height, num_frames, frame_rate
    def build(model: str, style: str) -> dict[str, Any]:
        p: dict[str, Any] = {"model": model, "prompt": req.prompt}
        if style == "simple":
            p.update(mode="text", seconds="10" if secs >= 7.5 else "5", size="720P")
        else:
            frames = ((min(req.num_frames, 241) - 1) // 8) * 8 + 1
            p.update(width=w, height=h, num_frames=frames, frame_rate=req.frame_rate)
            if req.negative_prompt:
                p["negative_prompt"] = req.negative_prompt
            if req.seed is not None:
                p["seed"] = req.seed
        return p

    models = list(AGNES_MODELS)
    styles = {m: ("frames" if "v2.0" in m else "simple") for m in models}
    deadline = time.time() + AGNES_MAX_WAIT
    backoff = 5.0
    invalid_retries = 0
    queue_full = 0
    async with httpx.AsyncClient(timeout=60) as client:
        # 1) Création de la tâche (attente patiente tant que la file Agnes est pleine)
        video_id = None
        while video_id is None:
            if not models:
                raise RuntimeError("aucun modèle vidéo Agnes utilisable avec ces clés (quota payant épuisé ou modèles indisponibles)")
            model = models[0]
            payload = build(model, styles[model])
            key = await agnes_pool.acquire(deadline)
            if key is None:
                raise RuntimeError(f"file Agnes pleine pendant {int(AGNES_MAX_WAIT / 60)} min ({queue_full} essais)")
            headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
            r, err = None, ""
            try:
                job.message = f"Agnes ({model}) : envoi de la demande…"
                r = await client.post(f"{AGNES_BASE}/v1/videos", json=payload, headers=headers)
            except httpx.HTTPError as e:
                err = f"réseau ({type(e).__name__})"
            if r is not None and r.status_code < 300:
                data = r.json()
                video_id = data.get("video_id") or data.get("id") or (data.get("data") or {}).get("video_id")
                if not video_id:
                    raise RuntimeError(f"réponse Agnes sans video_id : {str(data)[:200]}")
                break
            wait = backoff
            if r is not None:
                low = r.text.lower()
                err = f"HTTP {r.status_code} {r.text[:150]}"
                if "video_queue_full" in low or "queue is full" in low:
                    # Saturation Agnes : on garde notre place en réessayant régulièrement
                    queue_full += 1
                    agnes_pool.next_ok[key] = 0
                    wait = AGNES_QUEUE_RETRY
                    job.message = f"Agnes : file pleine, on réessaie (essai {queue_full}, prochain dans {int(wait)} s)"
                    log.info("job %s agnes queue full (%d)", job.id, queue_full)
                    await asyncio.sleep(wait)
                    continue
                if "insufficient_user_quota" in low or r.status_code == 402:
                    log.info("job %s modèle %s payant/épuisé → suivant", job.id, model)
                    models.pop(0); agnes_pool.next_ok[key] = 0
                    continue
                if r.status_code == 400 and ("forbidden field" in low or "is required" in low):
                    other = "frames" if styles[model] == "simple" else "simple"
                    if styles.get(model + "#tried") is None:
                        styles[model + "#tried"] = True
                        styles[model] = other             # mauvais format : on essaie l'autre
                    else:
                        models.pop(0)
                    agnes_pool.next_ok[key] = 0
                    continue
                if ("temporarily unavailable" in low or "get_channel_failed" in low or "model" in low and r.status_code in (404, 422)) and len(models) > 1:
                    models.append(models.pop(0))          # modèle indisponible : on le met en fin de liste
                    agnes_pool.next_ok[key] = 0
                    continue
                if r.status_code == 401 and "invalid token" in low and invalid_retries < 3:
                    invalid_retries += 1
                    agnes_pool.next_ok[key] = 0
                    await asyncio.sleep(3)
                    continue
                if r.status_code in (401, 403):
                    agnes_pool.penalize(key, 3600)        # clé refusée : on la met de côté
                    if r.status_code == 401:
                        err = "clé refusée par Agnes (Invalid token) — vérifiez ou régénérez-la sur platform.agnes-ai.com"
                    if all(agnes_pool.next_ok[k] > time.time() + 600 for k in agnes_pool.keys):
                        raise RuntimeError(f"toutes les clés Agnes sont refusées ({err})")
                    continue
                if r.status_code not in RETRYABLE:
                    raise RuntimeError(f"Agnes a refusé la demande : {err}")
                agnes_pool.penalize(key, backoff)
            job.message = f"Agnes indisponible ({err[:40]}) — nouvel essai dans {int(wait)} s"
            log.info("job %s agnes retry: %s", job.id, err)
            await asyncio.sleep(wait)
            backoff = min(backoff * 2, 120)
            if time.time() > deadline:
                raise RuntimeError("Agnes indisponible trop longtemps")

        # 2) Suivi de la tâche
        job.message = "Agnes : génération en cours…"
        poll_headers = {"Authorization": f"Bearer {key}"}
        start = time.time()
        while time.time() - start < 1200:
            await asyncio.sleep(6)
            try:
                r = await client.get(f"{AGNES_BASE}/agnesapi", params={"video_id": video_id, "model_name": model}, headers=poll_headers)
            except httpx.HTTPError:
                continue
            if r.status_code == 429 or r.status_code >= 500:
                await asyncio.sleep(10)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"suivi Agnes : HTTP {r.status_code} {r.text[:150]}")
            data = r.json()
            status = str(data.get("status") or (data.get("data") or {}).get("status") or "").lower()
            prog = data.get("progress")
            if isinstance(prog, (int, float)):
                job.progress = float(prog) / (100 if prog > 1 else 1)
            else:
                job.progress = min(0.95, (time.time() - start) / 240)
            if status in {"succeeded", "success", "completed", "done", "finished"}:
                url = _find_video_url(data)
                if not url:
                    raise RuntimeError(f"vidéo terminée mais URL introuvable : {str(data)[:200]}")
                job.message = "Agnes : téléchargement…"
                dest = OUTPUT_DIR / f"{job.id}.mp4"
                try:
                    async with client.stream("GET", url, timeout=300) as dl:
                        dl.raise_for_status()
                        with open(dest, "wb") as f:
                            async for chunk in dl.aiter_bytes():
                                f.write(chunk)
                    job.file = dest
                except Exception:
                    job.remote_url = url                   # on garde au moins le lien d'origine
                return
            if status in {"failed", "error", "cancelled", "canceled"}:
                raise RuntimeError(f"Agnes a échoué : {str(data)[:200]}")
        raise RuntimeError("Agnes : délai de génération dépassé")


# ─────────────────────────────────────────────────────────────────
# Moteur 2 : modèle open-source local (LTX-Video / Wan 2.1) sur GPU
# ─────────────────────────────────────────────────────────────────
class LocalModel:
    def __init__(self) -> None:
        self.pipe = None
        self.i2v = None
        self.lock = threading.Lock()

    def load(self) -> None:
        if self.pipe is not None:
            return
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("aucun GPU CUDA disponible")
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        log.info("Chargement du modèle local %s (VRAM %.1f Go, %s)…", LOCAL_MODEL, vram, dtype)
        if LOCAL_MODEL == "wan":
            from diffusers import AutoencoderKLWan, WanPipeline
            repo = os.environ.get("WAN_REPO", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers")
            vae = AutoencoderKLWan.from_pretrained(repo, subfolder="vae", torch_dtype=torch.float32)
            self.pipe = WanPipeline.from_pretrained(repo, vae=vae, torch_dtype=dtype)
        else:
            from diffusers import LTXImageToVideoPipeline, LTXPipeline
            repo = os.environ.get("LTX_REPO", "Lightricks/LTX-Video")
            self.pipe = LTXPipeline.from_pretrained(repo, torch_dtype=dtype)
            # Le pipeline image → vidéo réutilise les mêmes poids (pas de second téléchargement)
            self.i2v = LTXImageToVideoPipeline(**self.pipe.components)
        if vram < 30:
            self.pipe.enable_model_cpu_offload()
            if self.i2v is not None:
                self.i2v.enable_model_cpu_offload()
        else:
            self.pipe.to("cuda")
        try:
            self.pipe.vae.enable_tiling()
        except Exception:
            pass
        log.info("Modèle local prêt.")

    def generate(self, job: Job) -> Path:
        import torch
        from diffusers.utils import export_to_video

        with self.lock:
            job.message = "GPU : chargement du modèle (1re fois : quelques minutes)…"
            self.load()
            req = job.req
            # On garde le format (9:16, 16:9…) en limitant le grand côté pour tenir sur un GPU gratuit.
            scale = min(1.0, LOCAL_MAX_SIDE / max(req.width, req.height))
            w = max(256, int(req.width * scale) // 32 * 32)
            h = max(256, int(req.height * scale) // 32 * 32)
            if LOCAL_MODEL == "wan":
                fps = 16
                frames = min(req.num_frames, 121)
                frames = ((frames - 1) // 4) * 4 + 1
                steps = req.steps or 30
            else:
                fps = req.frame_rate
                frames = min(req.num_frames, 257)
                frames = ((frames - 1) // 8) * 8 + 1
                steps = req.steps or 40
            seed = req.seed if req.seed is not None else random.randint(0, 2**31 - 1)
            gen = torch.Generator(device="cpu").manual_seed(seed)
            neg = req.negative_prompt or "worst quality, inconsistent motion, blurry, jittery, distorted, watermark, text"

            def on_step(pipe, i, t, kw):
                job.progress = (i + 1) / steps
                job.message = f"GPU : étape {i + 1}/{steps}"
                return kw

            args = dict(prompt=req.prompt, negative_prompt=neg, width=w, height=h, num_frames=frames,
                        num_inference_steps=steps, generator=gen, callback_on_step_end=on_step)
            if LOCAL_MODEL == "wan":
                args["guidance_scale"] = 5.0
            if req.image and self.i2v is not None:
                import io
                from PIL import Image
                raw = req.image.split(",", 1)[-1]
                img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB").resize((w, h))
                frames_out = self.i2v(image=img, **args).frames[0]
            else:
                frames_out = self.pipe(**args).frames[0]
            dest = OUTPUT_DIR / f"{job.id}.mp4"
            export_to_video(frames_out, str(dest), fps=fps)
            torch.cuda.empty_cache()
            return dest


local_model = LocalModel()


async def run_local(job: Job) -> None:
    job.file = await asyncio.to_thread(local_model.generate, job)


# ─────────────────────────────────────────────────────────────────
# Moteur de test : fausse vidéo (vérifie toute la chaîne sans GPU)
# ─────────────────────────────────────────────────────────────────
def _mock_video(job: Job) -> Path:
    import imageio.v2 as imageio
    import numpy as np
    w, h = (job.req.width // 16) * 16, (job.req.height // 16) * 16
    w, h = min(w, 512), min(h, 512)
    n = min(job.req.num_frames, 72)
    dest = OUTPUT_DIR / f"{job.id}.mp4"
    yy, xx = np.mgrid[0:h, 0:w]
    with imageio.get_writer(dest, fps=job.req.frame_rate, codec="libx264", quality=6, macro_block_size=16) as wr:
        for i in range(n):
            job.progress = (i + 1) / n
            job.message = f"Test : image {i + 1}/{n}"
            t = i / n
            frame = np.stack([
                (127 + 127 * np.sin(xx / 40 + t * 6)), (127 + 127 * np.sin(yy / 50 + t * 4)),
                np.full((h, w), 200 * t)], axis=-1).astype("uint8")
            wr.append_data(frame)
            time.sleep(float(os.environ.get("MOCK_FRAME_DELAY", "0.01")))
    return dest


async def run_mock(job: Job) -> None:
    job.file = await asyncio.to_thread(_mock_video, job)


RUNNERS = {"agnes": run_agnes, "local": run_local, "mock": run_mock}


# ─────────────────────────────────────────────────────────────────
# File d'attente et cascade
# ─────────────────────────────────────────────────────────────────
async def process(job: Job) -> None:
    order = [b for b in (job.req.backends or BACKENDS) if b in RUNNERS and b in BACKENDS]
    if not order:
        job.status, job.error = "failed", "aucun moteur disponible sur ce serveur (ajoutez une clé Agnes ou un GPU)"
        job.finished = time.time()
        return
    job.status = "running"
    for backend in order:
        job.backend, job.progress = backend, 0.0
        try:
            log.info("job %s → %s", job.id, backend)
            await RUNNERS[backend](job)
            job.status, job.progress, job.message = "completed", 1.0, "Terminé"
            job.finished = time.time()
            cleanup()
            return
        except Exception as e:  # on passe au moteur suivant
            msg = f"{backend}: {str(e)[:300]}"
            log.warning("job %s échec %s", job.id, msg)
            job.attempts.append(msg)
    job.status = "failed"
    job.error = " | ".join(job.attempts)
    job.message = "Échec de tous les moteurs"
    job.finished = time.time()


async def worker(name: str) -> None:
    while True:
        job_id = await queue.get()
        job = JOBS.get(job_id)
        try:
            if job:
                await process(job)
        finally:
            if job_id in QUEUE_ORDER:
                QUEUE_ORDER.remove(job_id)
            queue.task_done()


def cleanup() -> None:
    files = sorted(OUTPUT_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    for f in files[KEEP_FILES:]:
        f.unlink(missing_ok=True)
    cutoff = time.time() - 86400
    for jid in [j for j, job in JOBS.items() if job.finished and job.finished < cutoff]:
        JOBS.pop(jid, None)


# ─────────────────────────────────────────────────────────────────
# API HTTP
# ─────────────────────────────────────────────────────────────────
app = FastAPI(title="DianaLuxe Video Server", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup() -> None:
    global queue
    queue = asyncio.Queue()
    # Agnes peut traiter plusieurs vidéos en parallèle (une par clé) ; le GPU local se sérialise lui-même.
    n_workers = max(1, len(AGNES_KEYS)) + (1 if "local" in BACKENDS or "mock" in BACKENDS else 0)
    for i in range(n_workers):
        asyncio.create_task(worker(f"w{i}"))
    log.info("Moteurs actifs : %s | clés Agnes : %d | workers : %d", BACKENDS or "aucun", len(AGNES_KEYS), n_workers)
    if "local" in BACKENDS and os.environ.get("PRELOAD", "1") == "1":
        threading.Thread(target=_preload, daemon=True).start()


def _preload() -> None:
    try:
        local_model.load()
    except Exception as e:
        log.warning("Préchargement du modèle local impossible : %s", e)


def check_token(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)) -> None:
    if not SERVER_TOKEN:
        return
    given = (authorization or "").removeprefix("Bearer ").strip() or (token or "")
    if not secrets.compare_digest(given, SERVER_TOKEN):
        raise HTTPException(401, "jeton DianaLuxe invalide")


def base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc))
    return f"{proto}://{host}/"


KEY_STATUS: dict[str, Any] = {"checked": 0, "valid": None, "detail": None}


async def check_agnes_keys() -> None:
    """Vérifie les clés auprès d'Agnes (paramètre anti-cache : /v1/models peut renvoyer une réponse en cache)."""
    if not AGNES_KEYS or time.time() - KEY_STATUS["checked"] < 300:
        return
    valid, detail = 0, []
    async with httpx.AsyncClient(timeout=20) as client:
        for i, k in enumerate(AGNES_KEYS):
            ok = False
            for _ in range(2):
                try:
                    r = await client.get(f"{AGNES_BASE}/v1/models", params={"_": uuid.uuid4().hex},
                                         headers={"Authorization": f"Bearer {k}", "Cache-Control": "no-cache"})
                    if r.status_code == 200:
                        ok = any("video" in m.get("id", "") for m in r.json().get("data", []))
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)
            valid += ok
            detail.append(f"clé {i + 1}: {'ok' if ok else 'refusée'}")
    KEY_STATUS.update(checked=time.time(), valid=valid, detail=", ".join(detail))


@app.get("/health")
async def health() -> dict[str, Any]:
    await check_agnes_keys()
    gpu = None
    try:
        import torch
        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0)
    except Exception:
        pass
    return {
        "ok": True, "service": "dianaluxe", "backends": BACKENDS, "agnes_keys": len(AGNES_KEYS),
        "agnes_keys_valid": KEY_STATUS["valid"], "agnes_keys_detail": KEY_STATUS["detail"],
        "local_model": LOCAL_MODEL if "local" in BACKENDS else None, "local_ready": local_model.pipe is not None,
        "gpu": gpu, "queued": sum(1 for j in JOBS.values() if j.status == "queued"),
        "running": sum(1 for j in JOBS.values() if j.status == "running"), "token_required": bool(SERVER_TOKEN),
    }


@app.post("/v1/videos", dependencies=[Depends(check_token)])
async def create_video(req: VideoRequest, request: Request) -> JSONResponse:
    if sum(1 for j in JOBS.values() if j.status in ("queued", "running")) >= 50:
        raise HTTPException(429, "file d'attente pleine, réessayez plus tard")
    job = Job(req)
    JOBS[job.id] = job
    QUEUE_ORDER.append(job.id)
    await queue.put(job.id)
    return JSONResponse(job.public(base_url(request)), status_code=201)


@app.get("/agnesapi", dependencies=[Depends(check_token)])
async def poll_agnes_style(request: Request, video_id: str = Query(...)) -> dict[str, Any]:
    job = JOBS.get(video_id)
    if not job:
        raise HTTPException(404, "vidéo inconnue")
    return job.public(base_url(request))


@app.get("/v1/videos/{video_id}", dependencies=[Depends(check_token)])
async def poll(video_id: str, request: Request) -> dict[str, Any]:
    return await poll_agnes_style(request, video_id)


@app.get("/files/{name}")
async def files(name: str) -> FileResponse:
    # Les noms de fichiers sont aléatoires (non devinables) : pas de jeton requis pour pouvoir les lire dans <video>.
    path = (OUTPUT_DIR / name).resolve()
    if path.parent != OUTPUT_DIR.resolve() or not path.is_file():
        raise HTTPException(404, "fichier introuvable")
    return FileResponse(path, media_type="video/mp4")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
