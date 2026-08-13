"""Scan toonflow dist/built front-end for hardcoded hosts/URLs/ports."""
import re
from pathlib import Path

p = Path(r'E:\94-Toonflow\data\web\index.html')
text = p.read_text(encoding='utf-8', errors='replace')
print(f'file size: {len(text)} bytes')

checks = [
    ('localhost (word)', r'\blocalhost\b'),
    ('127.0.0.1', r'127\.0\.0\.1(?![\d\.])'),
    ('0.0.0.0', r'\b0\.0\.0\.0\b'),
    ('pc.firey.me', r'pc\.firey\.me'),
    ('192.168.x', r'192\.168\.\d+\.\d+'),
    ('localhost:PORT', r'localhost:(\d+)'),
    ('http://literal', r'"http://[A-Za-z0-9.\-]{4,80}"'),
    ('http:// (any)', r'http://[A-Za-z0-9.\-/:?=&%_]{4,100}'),
    ('https:// (any)', r'https://[A-Za-z0-9.\-/:?=&%_]{4,100}'),
    ('ws:// / wss://', r'wss?://[A-Za-z0-9.\-/:?=&%_]{4,100}'),
    ('baseURL=', r'baseURL\s*[=:]'),
    ('BASE_URL', r'BASE_URL'),
    ('VITE_API', r'VITE_[A-Z_]+'),
    ('socket.io', r'socket\.io'),
    ('io(', r'\bio\('),
    ('window.location', r'window\.location'),
    ('location.origin', r'location\.origin'),
    ('port hardcode 10588', r'\b10588\b'),
    ('port hardcode other', r':(8188|8189|8190|11434|11451|3000|5000|8080|8000|8888|8880|7890|7897|9000|7777|7778|7779|9100)\b'),
    ('fetch URL', r'fetch\(`[^`]{0,200}'),
]

for name, pat in checks:
    matches = re.findall(pat, text)
    if matches:
        uniq = list(dict.fromkeys(matches))
        if isinstance(uniq[0], tuple):
            uniq = [m[0] for m in uniq if m]
        uniq = uniq[:25]
        print(f'\n=== {name} ({len(matches)} total / {len(uniq)} unique) ===')
        for m in uniq:
            s = m if len(m) <= 250 else m[:250] + '...'
            print(' ', repr(s))
