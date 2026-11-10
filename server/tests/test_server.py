"""Test d'intégration : faux Agnes saturé + cascade vers le moteur de test.
Lancer : python3 tests/test_server.py   (depuis le dossier server/)"""
import os, subprocess, sys, time, httpx

ENV = dict(os.environ, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost",
           AGNES_BASE_URL="http://127.0.0.1:8101", AGNES_API_KEYS="bad-key,good-key",
           AGNES_MIN_INTERVAL="1", AGNES_MAX_WAIT="60", DIANALUXE_BACKENDS="agnes,mock",
           DIANALUXE_TOKEN="secret", DIANALUXE_OUTPUT_DIR="/tmp/dl_test_out", PYTHONPATH=".")
procs = [subprocess.Popen([sys.executable, "-m", "uvicorn", "tests.fake_agnes:app", "--port", "8101"], env=ENV),
         subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--port", "8100"], env=ENV)]
c = httpx.Client(base_url="http://127.0.0.1:8100", trust_env=False, timeout=30)
H = {"Authorization": "Bearer secret"}

def wait(vid, limit=120):
    for _ in range(limit):
        d = c.get("/agnesapi", params={"video_id": vid}, headers=H).json()
        if d["status"] in ("completed", "failed"):
            return d
        time.sleep(1)
    raise TimeoutError(vid)

try:
    for _ in range(50):
        try:
            c.get("/health"); break
        except Exception: time.sleep(0.3)
    print("health", c.get("/health").json())
    assert c.post("/v1/videos", json={"prompt": "test"}).status_code == 401, "token must be required"

    # 1) Agnes saturé (2× 429) + une clé invalide → doit finir par réussir via Agnes
    r = c.post("/v1/videos", json={"prompt": "a cat on the beach", "width": 720, "height": 1280, "num_frames": 120}, headers=H)
    assert r.status_code == 201, r.text
    d = wait(r.json()["video_id"])
    print("agnes job:", d["status"], d["backend"], d["url"], d["attempts"])
    assert d["status"] == "completed" and d["backend"] == "agnes"
    v = c.get(d["url"].replace("http://127.0.0.1:8100", ""))
    assert v.status_code == 200 and len(v.content) > 1000

    # 2) Agnes indisponible → cascade vers le moteur suivant (mock)
    r = c.post("/v1/videos", json={"prompt": "test mock", "backends": ["mock"], "width": 512, "height": 512, "num_frames": 48}, headers=H)
    assert r.status_code == 201, r.text
    d = wait(r.json()["video_id"])
    print("mock job:", d["status"], d["backend"])
    assert d["status"] == "completed" and d["backend"] == "mock"
    print("ALL TESTS PASSED")
finally:
    for p in procs: p.terminate()
