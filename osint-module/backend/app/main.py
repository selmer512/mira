from fastapi import FastAPI
from app.api.osint import router as osint_router
from app.core.config import settings

app = FastAPI(title=settings.app_name)

@app.get("/health")
async def health():
    return {"ok": True, "service": settings.app_name}

app.include_router(osint_router, prefix="/api/osint", tags=["osint"])
