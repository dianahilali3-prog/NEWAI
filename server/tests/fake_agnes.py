"""Faux serveur Agnes pour les tests : refuse (429) les 2 premières demandes, puis réussit."""
import time, uuid
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse, Response

app = FastAPI()
calls = {"create": 0}
tasks = {}

@app.post("/v1/videos")
async def create(body: dict, authorization: str = Header(None)):
    """Reproduit les réponses réelles observées le 10/11/2026."""
    if authorization != "Bearer good-key":
        raise HTTPException(401, "Invalid token")
    model = body.get("model")
    if model == "agnes-video-2.5":
        return JSONResponse({"code": "insufficient_user_quota", "message": "Insufficient user quota, remaining: $0"}, 403)
    if model != "agnes-video-2.5-flash":
        return JSONResponse({"error": {"code": "get_channel_failed", "message": f"Model {model} is temporarily unavailable"}}, 500)
    for f in ("width", "height", "num_frames", "frame_rate"):
        if f in body:
            return JSONResponse({"code": "invalid_request", "message": f"{f} is a forbidden field"}, 400)
    if "mode" not in body:
        return JSONResponse({"code": "invalid_request", "message": "mode is required"}, 400)
    calls["create"] += 1
    if calls["create"] <= 2:
        return JSONResponse({"code": "video_queue_full", "message": "video queue is full, please retry later"}, 503)
    vid = uuid.uuid4().hex
    tasks[vid] = time.time()
    return {"video_id": vid, "status": "queued"}

@app.get("/agnesapi")
async def poll(video_id: str = Query(...)):
    t = tasks.get(video_id)
    if t is None:
        raise HTTPException(404)
    if time.time() - t < 3:
        return {"video_id": video_id, "status": "processing", "progress": 40}
    return {"video_id": video_id, "status": "completed", "data": {"url": "http://127.0.0.1:8101/video.mp4"}}

@app.get("/video.mp4")
async def video():
    return Response(open(__file__.replace("fake_agnes.py", "sample.mp4"), "rb").read(), media_type="video/mp4")

@app.get("/v1/models")
async def models(authorization: str = Header(None)):
    if authorization != "Bearer good-key":
        raise HTTPException(401, "Invalid token")
    return {"data": [{"id": "agnes-video-2.5-flash"}]}
