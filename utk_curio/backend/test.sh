trap "kill 0" SIGINT;
# Pin the backend to the dedicated test DBs under .curio/test/ so dev state
# is never touched. The session-scoped fixture in tests/conftest.py wipes +
# migrates on boot.
export CURIO_TESTING=1
python -m pytest tests/ -v
