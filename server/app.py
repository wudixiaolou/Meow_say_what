from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
from typing import Any, Dict
import uvicorn
import tempfile
import shutil
import subprocess
import os
import uuid

app = FastAPI(title="MeowLingo YAMNet Audio Classifier")

# Configure CORS so the React frontend can talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Only import inference after setting up FastAPI to allow fast startup of the app object
try:
    from inference import (
        classify_audio,
        get_runtime_status,
        set_active_profile,
        archive_current_as_legacy,
    )
except ImportError as e:
    print(f"Warning: Could not import inference module. {e}")
    def classify_audio(audio_bytes, profile: str | None = None):
        resolved_profile = profile or "active"
        return {
            "detected": False,
            "confidence": 0.0,
            "top_class": "mock_backend_unavailable",
            "all_top_classes": [],
            "intent_label": "unknown",
            "intent_confidence": 0.0,
            "intent_topk": [],
            "model_profile": resolved_profile,
            "mock_mode": True,
        }

    def get_runtime_status():
        return {
            "yamnet_loaded": False,
            "intent_head_loaded": False,
            "intent_labels_loaded": False,
            "active_profile": "active",
            "legacy_head_loaded": False,
            "legacy_labels_loaded": False,
        }

    def set_active_profile(profile: str):
        if profile not in {"active", "legacy"}:
            raise ValueError(f"unsupported profile: {profile}")
        return {"active_profile": profile}

    def archive_current_as_legacy(overwrite: bool = False):
        return {
            "ok": True,
            "archived": False,
            "reason": "inference_backend_unavailable",
            "legacy_model_path": "",
            "legacy_labels_path": "",
            "overwrite": bool(overwrite),
        }

class AudioData(BaseModel):
    audio_base64: str

class EventData(BaseModel):
    event_name: str
    ts: int
    page: str = ""
    payload: Dict[str, Any] = {}


class SwitchProfileRequest(BaseModel):
    profile: str


class ArchiveLegacyRequest(BaseModel):
    overwrite: bool = False

EVENTS_BUFFER: list[dict] = []

@app.post("/classify")
async def classify_audio_endpoint(data: AudioData):
    try:
        # Decode the base64 audio sent from the frontend
        # The frontend uses 'audio/pcm;rate=16000' and sends base64
        audio_bytes = base64.b64decode(data.audio_base64)
        
        # Run inference
        result = classify_audio(audio_bytes, profile="active")
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/classify/active")
async def classify_audio_active_endpoint(data: AudioData):
    try:
        audio_bytes = base64.b64decode(data.audio_base64)
        return classify_audio(audio_bytes, profile="active")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "YAMNet classification service is running.",
        "runtime": get_runtime_status(),
    }


@app.post("/runtime/classifier/switch")
def switch_classifier_profile(req: SwitchProfileRequest):
    profile = req.profile.strip().lower()
    if profile != "active":
        raise HTTPException(status_code=403, detail="legacy_profile_hidden")
    try:
        result = set_active_profile(profile)
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/runtime/legacy/archive")
def archive_legacy_model(req: ArchiveLegacyRequest):
    try:
        result = archive_current_as_legacy(overwrite=req.overwrite)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/events")
def collect_event(event: EventData):
    item = event.model_dump()
    EVENTS_BUFFER.append(item)
    if len(EVENTS_BUFFER) > 5000:
        del EVENTS_BUFFER[:-5000]
    return {"ok": True, "count": len(EVENTS_BUFFER)}

@app.get("/events/summary")
def events_summary():
    summary: Dict[str, int] = {}
    for event in EVENTS_BUFFER:
        name = str(event.get("event_name", "unknown"))
        summary[name] = summary.get(name, 0) + 1
    return {
        "total": len(EVENTS_BUFFER),
        "summary": summary,
    }

def remove_file(path: str):
    try:
        os.remove(path)
    except Exception:
        pass

@app.post("/video/convert")
async def convert_video(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    # Create unique temp filenames
    unique_id = str(uuid.uuid4())
    temp_dir = tempfile.gettempdir()
    input_path = os.path.join(temp_dir, f"{unique_id}_input.webm")
    output_path = os.path.join(temp_dir, f"{unique_id}_output.mp4")

    try:
        # Save uploaded file
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Run ffmpeg conversion
        # Use -y to overwrite output file if it exists
        # Use -c:v libx264 for H.264 video codec (widely compatible)
        # Use -preset fast for faster encoding
        # Use -c:a aac for AAC audio codec
        command = [
            "ffmpeg",
            "-y",
            "-i", input_path,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            output_path
        ]
        
        process = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False
        )

        if process.returncode != 0:
            error_msg = process.stderr.decode()
            print(f"FFmpeg error: {error_msg}")
            raise HTTPException(status_code=500, detail="Video conversion failed")

        if not os.path.exists(output_path):
             raise HTTPException(status_code=500, detail="Conversion output not found")

        # Cleanup input file immediately
        remove_file(input_path)

        # Cleanup output file after response is sent
        background_tasks.add_task(remove_file, output_path)

        return FileResponse(
            output_path, 
            media_type="video/mp4", 
            filename="converted_video.mp4"
        )

    except Exception as e:
        # Cleanup on error
        remove_file(input_path)
        remove_file(output_path)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8011, reload=True)
