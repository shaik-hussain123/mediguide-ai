"""MediGuide AI API package - Phase 2: Dosage Safety, Drug Interaction, and Safety Score APIs."""

from fastapi import FastAPI

# Initialize FastAPI app with enhanced configuration
def create_app() -> FastAPI:
    app = FastAPI(
        title="MediGuide AI API",
        description="India's CDSCO-approved medicine information system with Phase 2 APIs",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
    )
    return app

# Export the create_app function for programmatic use
__all__ = ["create_app"]