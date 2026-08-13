"""Fix Ubuntu deploy:
  1) apt install build-essential python3 (for node-gyp)
  2) mkdir -p logs
  3) remove failed node_modules + reinstall
  4) start service + verify
  5) update vendorConfig (ComfyUI URL -> 192.168.2.165:8188) using python3 sqlite3
"""
import paramiko, sys, time, json
from pathlib import Path

HOST, USER, PASS = '192.168.2.184', 'fireabyss', 'yY19841115.'
WWW = '/www/toonflow-app'

def run(ssh, cmd, timeout=900, check=True):
    print(f'>>> {cmd[:200]}')
    sin, sout, serr = ssh.exec_command(cmd, timeout=timeout)
    out = sout.read().decode('utf-8', 'replace')
    err = serr.read().decode('utf-8', 'replace')
    rc = sout.channel.recv_exit_status()
    if out.strip(): print(out.strip()[:5000])
    if err.strip(): print('STDERR:', err.strip()[:3000])
    print(f'  -> rc={rc}')
    if check and rc != 0:
        raise RuntimeError(f'cmd failed (rc={rc}): {cmd[:200]}')
    return rc, out, err

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS,
                allow_agent=False, look_for_keys=False, timeout=20)

    # 1. Install build deps
    print('=== Step 1: apt install build-essential python3 ===')
    run(ssh, f'echo "{PASS}" | sudo -S apt-get update -y 2>&1 | tail -5', timeout=120)
    run(ssh, f'echo "{PASS}" | sudo -S apt-get install -y build-essential python3 2>&1 | tail -5', timeout=300)

    # 2. mkdir logs
    print('=== Step 2: mkdir logs ===')
    run(ssh, f'mkdir -p {WWW}/logs')

    # 3. Clean reinstall
    print('=== Step 3: rm node_modules + yarn install ===')
    run(ssh, f'rm -rf {WWW}/node_modules')
    run(ssh, f'cd {WWW} && yarn install --network-timeout 600000 2>&1 | tail -30', timeout=1500)

    # 4. Stop service first
    print('=== Step 4: systemctl stop + clear logs ===')
    run(ssh, 'systemctl --user stop toonflow.service', check=False)
    time.sleep(2)
    run(ssh, f'echo "" > {WWW}/logs/serve.log; echo "" > {WWW}/logs/serve.err.log')

    # 5. Start service
    print('=== Step 5: systemctl --user start toonflow ===')
    run(ssh, 'systemctl --user start toonflow.service')
    time.sleep(8)
    run(ssh, 'systemctl --user status toonflow.service --no-pager', check=False)

    # 6. Port listen check
    print('=== Step 6: port 10588 listen check ===')
    run(ssh, 'ss -tlnp 2>&1 | grep -E "10588|LISTEN" | head -10', check=False)

    # 7. HTTP test
    print('=== Step 7: HTTP test ===')
    run(ssh, 'curl -s -o /dev/null -w "HTTP %{http_code} size=%{size_download}\\n" --max-time 10 http://127.0.0.1:10588/', check=False)

    # 8. Tail logs
    print('=== Step 8: tail logs ===')
    run(ssh, f'tail -20 {WWW}/logs/serve.log', check=False)
    run(ssh, f'tail -20 {WWW}/logs/serve.err.log', check=False)

    # 9. Update vendorConfig via python3
    print('=== Step 9: inspect + update vendorConfig (ComfyUI URL) ===')
    run(ssh, f'cd {WWW} && python3 -c "import sqlite3; conn=sqlite3.connect(\\"data/db2.sqlite\\"); conn.row_factory=sqlite3.Row; print(\\"SCHEMA:\\"); [print(\\"  \\"+r[1]+\\":"+r[2]) for r in conn.execute(\\"SELECT * FROM sqlite_master WHERE type=\\\\\\"table\\\\\\" AND name=\\\\\\"o_vendorConfig\\\\\\"\\")]; print(\\"\\nVENDORS:\\"); [print(dict(r)) for r in conn.execute(\\"SELECT id,name,type,baseUrl,apiKey FROM o_vendorConfig\\")]"', check=False)

    # Find vendor(s) with 8188 in baseUrl and update
    update_cmd = f'''cd {WWW} && python3 << 'PYEOF'
import sqlite3
conn = sqlite3.connect('data/db2.sqlite')
conn.row_factory = sqlite3.Row
print('BEFORE:')
for r in conn.execute("SELECT id, name, type, baseUrl, inputValues FROM o_vendorConfig"):
    print(f'  [{r["id"]}] {r["name"]} ({r["type"]}) baseUrl={r["baseUrl"]!r}')
    print(f'        inputValues={r["inputValues"]!r}'[:300])

# Find any vendor pointing to localhost:8188 or 127.0.0.1:8188
conn.execute("UPDATE o_vendorConfig SET baseUrl = REPLACE(REPLACE(baseUrl, '127.0.0.1:8188', '192.168.2.165:8188'), 'localhost:8188', '192.168.2.165:8188')")
n1 = conn.total_changes
# Also try to update inside inputValues JSON (some vendors keep URL there)
import json
for r in conn.execute("SELECT id, inputValues FROM o_vendorConfig"):
    iv = r['inputValues']
    if not iv: continue
    try:
        d = json.loads(iv)
    except Exception:
        continue
    changed = False
    for k, v in list(d.items()):
        if isinstance(v, str) and ('127.0.0.1:8188' in v or 'localhost:8188' in v):
            d[k] = v.replace('127.0.0.1:8188', '192.168.2.165:8188').replace('localhost:8188', '192.168.2.165:8188')
            changed = True
    if changed:
        conn.execute("UPDATE o_vendorConfig SET inputValues=? WHERE id=?", (json.dumps(d, ensure_ascii=False), r['id']))
        print(f'  updated inputValues for id={r["id"]}')

conn.commit()
print('AFTER:')
for r in conn.execute("SELECT id, name, type, baseUrl, inputValues FROM o_vendorConfig"):
    print(f'  [{r["id"]}] {r["name"]} ({r["type"]}) baseUrl={r["baseUrl"]!r}')
    print(f'        inputValues={r["inputValues"]!r}'[:300])
conn.close()
PYEOF
'''
    run(ssh, update_cmd)

    # 10. Restart
    print('=== Step 10: restart toonflow ===')
    run(ssh, 'systemctl --user restart toonflow.service')
    time.sleep(5)
    run(ssh, 'systemctl --user status toonflow.service --no-pager', check=False)
    run(ssh, 'ss -tlnp 2>&1 | grep 10588', check=False)
    run(ssh, 'curl -s -o /dev/null -w "HTTP %{http_code} size=%{size_download}\\n" --max-time 10 http://127.0.0.1:10588/', check=False)

    ssh.close()
    print('\n=== DONE ===')

if __name__ == '__main__':
    main()
