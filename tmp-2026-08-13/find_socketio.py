"""Find socket.io client init / connection URL hardcoded in dist."""
import re
from pathlib import Path

p = Path(r'E:\94-Toonflow\data\web\index.html')
text = p.read_text(encoding='utf-8', errors='replace')

# 1) any io() call with non-vue/slots context
print('=== io() calls containing network hints ===')
for m in re.finditer(r'\bio\([^)]{0,300}\)', text):
    s = m.group(0)
    if any(k in s for k in ['/api', 'http', 'localhost', 'window.location', 'Manager', 'ns(', 'baseUrl', 'path:']):
        print(' ', s[:300])
        print('  ---')

# 2) look for /socket.io path
print('\n=== /socket.io path strings ===')
for m in re.finditer(r'/socket\.io[^\s"]{0,80}', text):
    s = m.group(0)
    print(' ', repr(s[:200]))

# 3) look for any "io(" in socket import / init context near 'socketInit' or 'productionAgent' or 'scriptAgent'
print('\n=== productionAgent/scriptAgent namespace connection context ===')
for kw in ['productionAgent', 'scriptAgent']:
    for m in re.finditer(re.escape(kw), text):
        idx = m.start()
        ctx = text[max(0, idx-100):idx+400]
        # only show if 'io(' or 'Manager' or '/api' nearby
        if any(k in ctx for k in ['io(', 'Manager', '/api/', 'connect', 'namespace']):
            print(f'  [{kw}] ctx:')
            print(f'    {ctx[:400]}')
            print('    ---')
            break  # one per keyword
