"""Push vendor update script to Ubuntu, run it, then verify and restart toonflow."""
import paramiko, time
from pathlib import Path

HOST, USER, PASS = '192.168.2.184', 'fireabyss', 'yY19841115.'
WWW = '/www/toonflow-app'

def run(ssh, cmd, timeout=300, check=True):
    print(f'>>> {cmd[:200]}')
    sin, sout, serr = ssh.exec_command(cmd, timeout=timeout)
    out = sout.read().decode('utf-8', 'replace')
    err = serr.read().decode('utf-8', 'replace')
    rc = sout.channel.recv_exit_status()
    if out.strip(): print(out.strip()[:5000])
    if err.strip(): print('STDERR:', err.strip()[:2000])
    print(f'  -> rc={rc}')
    if check and rc != 0:
        raise RuntimeError(f'cmd failed (rc={rc}): {cmd[:200]}')
    return rc, out, err

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS,
                allow_agent=False, look_for_keys=False, timeout=20)
    sftp = ssh.open_sftp()

    # 1. Upload vendor fix script
    print('=== Step 1: upload vendor fix script ===')
    script_local = Path(r'E:\94-Toonflow\tmp-2026-08-13\update_vendor_url.py')
    sftp.put(str(script_local), '/tmp/update_vendor_url.py')
    print(f'Uploaded: {sftp.stat("/tmp/update_vendor_url.py").st_size} bytes')

    # 2. Run it
    print('\n=== Step 2: run vendor update ===')
    run(ssh, f'python3 /tmp/update_vendor_url.py', timeout=60)

    # 3. Restart toonflow
    print('\n=== Step 3: restart toonflow ===')
    run(ssh, 'systemctl --user restart toonflow.service')
    time.sleep(4)
    run(ssh, 'systemctl --user status toonflow.service --no-pager', check=False)

    # 4. Verify port + HTTP
    print('\n=== Step 4: verify port + HTTP ===')
    run(ssh, 'ss -tlnp 2>&1 | grep 10588', check=False)
    run(ssh, 'curl -s -o /dev/null -w "HTTP %{http_code} size=%{size_download}\\n" --max-time 10 http://127.0.0.1:10588/', check=False)

    # 5. Verify login API works
    print('\n=== Step 5: verify login API ===')
    run(ssh, "curl -s -X POST -H 'Content-Type: application/json; charset=utf-8' -d '{\"username\":\"fireabyss\",\"password\":\"yY19841115.\"}' --max-time 10 http://127.0.0.1:10588/api/login/login | head -c 500", check=False)

    # 6. Verify ComfyUI reachable from Ubuntu (cross-host)
    print('\n=== Step 6: verify Ubuntu -> ComfyUI @ 192.168.2.165:8188 ===')
    run(ssh, "curl -s -o /dev/null -w 'ComfyUI HTTP=%{http_code} time=%{time_total}\\n' --max-time 10 http://192.168.2.165:8188/", check=False)

    # 7. Check systemd linger (so service auto-starts at boot)
    print('\n=== Step 7: verify linger ===')
    run(ssh, 'loginctl show-user fireabyss 2>&1 | grep Linger', check=False)

    # 8. Verify enabled
    print('\n=== Step 8: verify service enabled ===')
    run(ssh, 'systemctl --user is-enabled toonflow.service', check=False)

    sftp.close()
    ssh.close()
    print('\n=== DONE ===')

if __name__ == '__main__':
    main()
