"""Precheck Ubuntu VM: node/yarn, /www existence, 10588 conflict, owner."""
import paramiko, json, sys

HOST, USER, PASS = '192.168.2.184', 'fireabyss', 'yY19841115.'

def run(ssh, cmd, timeout=60):
    sin, sout, serr = ssh.exec_command(cmd, timeout=timeout)
    return sout.read().decode('utf-8', 'replace'), serr.read().decode('utf-8', 'replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS,
            allow_agent=False, look_for_keys=False, timeout=20)

checks = [
    ('whoami', 'whoami && id'),
    ('node version', 'node --version 2>&1'),
    ('npm version', 'npm --version 2>&1'),
    ('yarn version', 'yarn --version 2>&1'),
    ('pnpm version', 'pnpm --version 2>&1'),
    ('df -h /www', 'df -h /www 2>&1'),
    ('ls -la /www', 'ls -la /www 2>&1'),
    ('/www/toonflow-app exists?', 'ls -la /www/toonflow-app 2>&1 | head -5'),
    ('10588 listen?', 'ss -tlnp 2>&1 | grep 10588 || netstat -tlnp 2>&1 | grep 10588 || echo NOT_LISTEN'),
    ('10588 reserved?', 'netsh 2>/dev/null; cat /proc/sys/net/ipv4/ip_local_port_range 2>&1'),
    ('existing 10588 process?', 'pgrep -af 10588 || echo NO'),
    ('systemd available?', 'systemctl --version 2>&1 | head -1'),
    ('apt sources', 'cat /etc/apt/sources.list.d/*.sources 2>/dev/null | head -5'),
    ('clash running?', 'pgrep -af clash 2>&1 | head -3 || echo NO_CLASH'),
]

for label, cmd in checks:
    out, err = run(ssh, cmd)
    print(f'=== {label} ===')
    print((out + err).strip()[:600])
    print()

ssh.close()
