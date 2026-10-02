from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .solver import generate_timetable
from .validation import validate_schedule

app = FastAPI(
    title="SmartSlot Scheduling Service",
    version="1.0.0",
    description="Constraint-based timetable generation using Google OR-Tools CP-SAT.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("SCHEDULER_CORS_ORIGINS", "http://localhost:4000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("SCHEDULER_API_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Scheduler service authentication is not configured.")
    supplied = (authorization or "").removeprefix("Bearer ")
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid service credentials.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "smartslot-scheduler"}


@app.post("/generate", dependencies=[Depends(require_service_token)])
def generate(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return generate_timetable(payload)
    except Exception as exc:  # Keep implementation details out of service responses.
        raise HTTPException(status_code=500, detail="Scheduling failed while constructing or solving the model.") from exc


@app.post("/validate", dependencies=[Depends(require_service_token)])
def validate(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload.get("data"), dict) or not isinstance(payload.get("schedule"), list):
        raise HTTPException(status_code=400, detail="Both data and schedule are required.")
    conflicts = validate_schedule(payload["data"], payload["schedule"])
    return {"valid": not bool(conflicts), "conflicts": conflicts}
