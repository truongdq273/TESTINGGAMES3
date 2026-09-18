"""Compatibility launcher: use the authenticated Node server, never the old open relay."""
import os
from pathlib import Path
os.execvp('node', ['node', str(Path(__file__).with_name('ws-server.js'))])
