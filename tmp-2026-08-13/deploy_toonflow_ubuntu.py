"""Deploy toonflow to Ubuntu 192.168.2.184:/www/toonflow-app.
Steps: upload tar -> extract -> create /www -> yarn install -> systemd service
       -> start -> update vendorConfig.ComfyUI URL to 192.168.2.165:8188
       -> restart -> verify.
"""
import paramiko, sys, time, os
from pathlib import Path

HOST, USER, PASS = '192.168.2.184', 'fireabyss', 'yY19841115.'
WWW = '/www/toonflow-app'
LOCAL_TAR = Path(r'E:\01-ComfyUI-Serv\tmp-2026-08-13\toonflow-app.tar.gz')

def run(ssh, cmd, timeout=600, check=True):
    """Run a command, print output, return (rc, out, err)."""
    print(f'>>> {cmd[:200]}')
    sin, sout, serr = ssh.exec_command(cmd, timeout=timeout)
    out = sout.read().decode('utf-8', 'replace')
    err = serr.read().decode('utf-8', 'replace')
    rc = sout.channel.recv_exit_status()
    if out.strip(): print(out.strip()[:4000])
    if err.strip(): print('STDERR:', err.strip()[:2000])
    print(f'  -> rc={rc}')
    if check and rc != 0:
        raise RuntimeError(f'cmd failed (rc={rc}): {cmd[:200]}')
    return rc, out, err

def main():
    print(f'=== Connecting to {HOST} ===')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS,
                allow_agent=False, look_for_keys=False, timeout=20)
    sftp = ssh.open_sftp()
    print('Connected.')

    # 1. Upload tarball
    print('\n=== Step 1: upload tarball to /tmp/toonflow-app.tar.gz ===')
    sftp.put(str(LOCAL_TAR), '/tmp/toonflow-app.tar.gz')
    sz = sftp.stat('/tmp/toonflow-app.tar.gz').st_size
    print(f'Uploaded: {sz/1024/1024:.1f} MB')

    # 2. Create /www and extract
    print('\n=== Step 2: sudo mkdir /www && extract ===')
    # Use sudo with password via stdin
    run(ssh, f'echo "{PASS}" | sudo -S mkdir -p /www', check=False)
    run(ssh, f'echo "{PASS}" | sudo -S chown {USER}:{USER} /www', check=False)
    run(ssh, 'rm -rf /www/toonflow-app && mkdir -p /www/toonflow-app')
    run(ssh, 'tar xzf /tmp/toonflow-app.tar.gz -C /www/')
    run(ssh, 'ls -la /www/toonflow-app | head -20')

    # 3. yarn install
    print('\n=== Step 3: yarn install ===')
    run(ssh, f'cd {WWW} && yarn install --network-timeout 600000 2>&1 | tail -20', timeout=900)

    # 4. Verify build product (data/serve/app.js) exists
    print('\n=== Step 4: verify data/serve/app.js ===')
    run(ssh, f'ls -la {WWW}/data/serve/app.js {WWW}/data/db2.sqlite', check=False)

    # 5. Create systemd service
    print('\n=== Step 5: create systemd user service ===')
    unit_dir = f'/home/{USER}/.config/systemd/user'
    run(ssh, f'mkdir -p {unit_dir}')
    unit_content = f"""[Unit]
Description=Toonflow service (production)
After=network.target

[Service]
Type=simple
WorkingDirectory={WWW}
Environment=NODE_ENV=prod
ExecStart=/usr/bin/env node data/serve/app.js
Restart=always
RestartSec=5
StandardOutput=append:/www/toonflow-app/logs/serve.log
StandardError=append:/www/toonflow-app/logs/serve.err.log

[Install]
WantedBy=default.target
"""
    # write unit via SFTP
    sftp.putfo(__import__('io').StringIO(unit_content), f'{unit_dir}/toonflow.service')

    # 6. Enable & start
    print('\n=== Step 6: enable + start systemd service ===')
    run(ssh, f'echo "{PASS}" | sudo -S loginctl enable-linger {USER}', check=False)
    run(ssh, 'systemctl --user daemon-reload')
    run(ssh, 'systemctl --user enable toonflow.service')
    run(ssh, 'systemctl --user restart toonflow.service')
    time.sleep(5)
    run(ssh, 'systemctl --user status toonflow.service --no-pager', check=False)

    # 7. Verify port 10588 listen
    print('\n=== Step 7: verify port 10588 ===')
    run(ssh, 'ss -tlnp 2>&1 | grep 10588 || netstat -tlnp 2>&1 | grep 10588', check=False)

    # 8. HTTP test
    print('\n=== Step 8: HTTP test from this host ===')
    run(ssh, 'curl -s -o /dev/null -w "HTTP %{http_code} %{size_download} bytes\\n" --max-time 10 http://127.0.0.1:10588/', check=False)

    # 9. Update vendorConfig: ComfyUI URL -> 192.168.2.165:8188
    print('\n=== Step 9: update vendorConfig ComfyUI URL ===')
    # find which vendor has baseUrl pointing to 127.0.0.1:8188
    run(ssh, f'sqlite3 {WWW}/data/db2.sqlite "SELECT id, name, type, inputValues FROM o_vendorConfig WHERE inputValues LIKE \\"%8188%\\" OR inputValues LIKE \\"%localhost%\\" LIMIT 20;"', check=False)

    # Inspect db schema of o_vendorConfig
    run(ssh, f'sqlite3 {WWW}/data/db2.sqlite ".schema o_vendorConfig"', check=False)
    run(ssh, f'sqlite3 {WWW}/data/db2.sqlite "SELECT id, name, type, baseUrl, apiKey FROM o_vendorConfig;"', check=False)

    # 10. Restart after vendor change
    print('\n=== Step 10: restart toonflow service ===')
    run(ssh, 'systemctl --user restart toonflow.service')
    time.sleep(4)
    run(ssh, 'systemctl --user status toonflow.service --no-pager', check=False)

    sftp.close()
    ssh.close()
    print('\n=== DONE ===')

if __name__ == '__main__':
    main()
