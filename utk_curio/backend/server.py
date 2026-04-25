import os
from utk_curio.backend.app import create_app

app = create_app()

with app.app_context():
    try:
        from utk_curio.backend.app.users.services import _shared_guest_user
        _shared_guest_user()
    except Exception:
        app.logger.warning("Could not ensure guest user on startup", exc_info=True)

@app.route('/health', methods=['GET'])
def health():
    return 'OK', 200

if __name__ == '__main__':
    app.run(
        host=os.getenv('FLASK_BACKEND_HOST', 'localhost'),
        port=int(os.getenv('FLASK_BACKEND_PORT', 5002)),
        threaded=True,
        debug=True,
        use_reloader=os.getenv('FLASK_USE_RELOADER', '1') != '0',
    )

