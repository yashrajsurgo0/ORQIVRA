"""Compatibility entry point for the agricultural analysis API."""
from app import app

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001)
