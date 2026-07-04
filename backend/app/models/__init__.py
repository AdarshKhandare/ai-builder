"""Persistence layer for Forge.

This package groups the SQLAlchemy ORM model and engine setup
(``database``) with the Pydantic request/response schemas
(``schemas``) used by ``app.routes.projects``.

The two modules are intentionally kept separate so the wire-format
validation (Pydantic) and the storage model (SQLAlchemy) can evolve
independently. A future migration to Postgres or a different ORM only
needs to touch ``database.py``.
"""
