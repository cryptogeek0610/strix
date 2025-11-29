from __future__ import annotations

import asyncio
import logging
import threading
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from strix.agents.StrixAgent import StrixAgent
from strix.telemetry.tracer import Tracer, set_global_tracer, get_global_tracer
from strix.llm.config import LLMConfig

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Strix Web Interface")

# CORS for development convenience
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
current_agent: StrixAgent | None = None
scan_task: asyncio.Task[Any] | None = None

class ScanRequest(BaseModel):
    target: str
    target_type: str  # "url", "repo", "local"
    instruction: str | None = None
    run_name: str | None = None

class ScanStatus(BaseModel):
    is_running: bool
    logs: list[dict[str, Any]]
    vulnerabilities: list[dict[str, Any]]
    agents: dict[str, Any]
    stats: dict[str, Any] | None

@app.post("/api/scan")
async def start_scan(request: ScanRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    global current_agent, scan_task

    if scan_task and not scan_task.done():
        return {"status": "error", "message": "Scan already running"}

    run_name = request.run_name or f"web-scan-{request.target_type}"
    
    # Initialize Tracer
    tracer = Tracer(run_name)
    set_global_tracer(tracer)

    # Prepare Target Info
    target_info = {
        "type": "web_application" if request.target_type == "url" else 
                "repository" if request.target_type == "repo" else "local_code",
        "details": {}
    }
    
    if request.target_type == "url":
        target_info["details"]["target_url"] = request.target
    elif request.target_type == "repo":
        target_info["details"]["target_repo"] = request.target
    elif request.target_type == "local":
        target_info["details"]["target_path"] = request.target

    scan_config = {
        "scan_id": run_name,
        "targets": [target_info],
        "user_instructions": request.instruction or "",
        "run_name": run_name,
    }
    
    tracer.set_scan_config(scan_config)

    # Initialize Agent
    llm_config = LLMConfig()
    agent_config = {
        "llm_config": llm_config,
        "max_iterations": 300,
        "non_interactive": True, # Web mode is non-interactive for the agent logic itself
    }
    
    current_agent = StrixAgent(agent_config)

    # Start Scan in Background
    async def run_scan_wrapper():
        try:
            await current_agent.execute_scan(scan_config)
        except Exception as e:
            logger.error(f"Scan failed: {e}")
        finally:
            tracer.cleanup()

    scan_task = asyncio.create_task(run_scan_wrapper())
    
    return {"status": "started", "run_name": run_name}

@app.get("/api/status")
async def get_status() -> ScanStatus:
    tracer = get_global_tracer()
    
    if not tracer:
        return ScanStatus(
            is_running=False,
            logs=[],
            vulnerabilities=[],
            agents={},
            stats=None
        )

    is_running = scan_task is not None and not scan_task.done()
    
    # Get recent logs (last 50 for performance, or implement pagination later)
    logs = tracer.chat_messages[-50:] if tracer.chat_messages else []
    
    return ScanStatus(
        is_running=is_running,
        logs=logs,
        vulnerabilities=tracer.vulnerability_reports,
        agents=tracer.agents,
        stats=tracer.get_total_llm_stats() if tracer else None
    )

@app.post("/api/stop")
async def stop_scan() -> dict[str, str]:
    global scan_task
    if scan_task and not scan_task.done():
        scan_task.cancel()
        try:
            await scan_task
        except asyncio.CancelledError:
            pass
        return {"status": "stopped"}
    return {"status": "no_scan_running"}

# --- Settings API ---

class Settings(BaseModel):
    model_name: str = "openai/gpt-4"
    api_base: str | None = None
    timeout: int = 600
    default_instruction: str | None = None

class SettingsManager:
    def __init__(self):
        self.config_path = Path("strix_config.json")
        self._settings = self._load_settings()

    def _load_settings(self) -> Settings:
        if self.config_path.exists():
            try:
                with self.config_path.open("r") as f:
                    data = json.load(f)
                return Settings(**data)
            except Exception as e:
                logger.error(f"Failed to load settings: {e}")
        return Settings()

    def save_settings(self, settings: Settings):
        try:
            with self.config_path.open("w") as f:
                json.dump(settings.model_dump(), f, indent=2)
            self._settings = settings
        except Exception as e:
            logger.error(f"Failed to save settings: {e}")
            raise

    def get_settings(self) -> Settings:
        return self._settings

settings_manager = SettingsManager()

@app.get("/api/config")
async def get_config() -> Settings:
    return settings_manager.get_settings()

@app.post("/api/config")
async def update_config(settings: Settings) -> dict[str, str]:
    settings_manager.save_settings(settings)
    return {"status": "updated"}

# --- History API ---

class RunSummary(BaseModel):
    run_id: str
    run_name: str
    start_time: str
    status: str
    vuln_count: int

class HistoryManager:
    def __init__(self):
        self.runs_dir = Path("strix_runs")

    def list_runs(self) -> list[RunSummary]:
        if not self.runs_dir.exists():
            return []
        
        runs = []
        for run_dir in self.runs_dir.iterdir():
            if run_dir.is_dir():
                # Try to read metadata from a file if it exists, or infer
                # For now, we'll just list directories and try to find basic info
                # In a real impl, Tracer should save a metadata.json
                # We will try to read vulnerabilities.csv to count vulns
                vuln_count = 0
                vuln_file = run_dir / "vulnerabilities.csv"
                if vuln_file.exists():
                    try:
                        with vuln_file.open("r") as f:
                            vuln_count = sum(1 for _ in f) - 1 # Subtract header
                    except:
                        pass
                
                # Try to get timestamp from dir creation or metadata
                timestamp = datetime.fromtimestamp(run_dir.stat().st_mtime).isoformat()
                
                runs.append(RunSummary(
                    run_id=run_dir.name,
                    run_name=run_dir.name, # Could be improved with metadata
                    start_time=timestamp,
                    status="completed", # Simplified
                    vuln_count=max(0, vuln_count)
                ))
        
        # Sort by newest first
        runs.sort(key=lambda x: x.start_time, reverse=True)
        return runs

    def get_run_details(self, run_id: str) -> ScanStatus | None:
        run_dir = self.runs_dir / run_id
        if not run_dir.exists():
            return None
        
        # Reconstruct ScanStatus from disk artifacts
        # This is a simplified reconstruction. 
        # Ideally Tracer would serialize the full state.
        
        vulns = []
        vuln_dir = run_dir / "vulnerabilities"
        if vuln_dir.exists():
            for v_file in vuln_dir.glob("*.md"):
                try:
                    content = v_file.read_text()
                    # Parse basic info from MD (simplified)
                    vulns.append({
                        "id": v_file.stem,
                        "title": v_file.stem, # Placeholder
                        "severity": "unknown",
                        "content": content
                    })
                except:
                    pass

        return ScanStatus(
            is_running=False,
            logs=[], # Logs might not be persisted in a structured way yet
            vulnerabilities=vulns,
            agents={},
            stats=None
        )

history_manager = HistoryManager()

@app.get("/api/runs")
async def list_runs() -> list[RunSummary]:
    return history_manager.list_runs()

@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> ScanStatus:
    details = history_manager.get_run_details(run_id)
    if not details:
        # Return empty if not found
        return ScanStatus(is_running=False, logs=[], vulnerabilities=[], agents={}, stats=None)
    return details


# Mount static files - MUST BE LAST
app.mount("/", StaticFiles(directory="strix/server/static", html=True), name="static")

