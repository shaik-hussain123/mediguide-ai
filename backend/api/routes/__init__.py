"""API Routes Module for MediGuide AI.

This package contains dedicated route modules for Phase 2 APIs:
- dosage.py: Dosage Safety API routes
- interactions.py: Drug Interaction API routes
"""

from . import dosage, interactions as _interactions


def get_dosage_router():
    return dosage.router


def get_interactions_router():
    return _interactions.router


__all__ = ["dosage", "interactions"]