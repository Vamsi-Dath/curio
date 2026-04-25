from flask import Blueprint

bp = Blueprint("projects", __name__)

from utk_curio.backend.app.projects import models  # noqa: E402, F401
