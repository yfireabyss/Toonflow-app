# One-shot: move Windows TCP/UDP dynamic port range to IANA standard (49152-65535)
# so the Hyper-V reserved block (10548-10647) no longer covers port 10588.
# Run with elevated privileges (scheduled task /RL HIGHEST).
$ErrorActionPreference = 'Stop'
$log = 'E:\94-Toonflow\logs\fix_hyperv_port.log'
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File $log -Encoding utf8

netsh int ipv4 set dynamic tcp start=49152 num=16384 2>&1 | Out-File $log -Append -Encoding utf8
netsh int ipv4 set dynamic udp start=49152 num=16384 2>&1 | Out-File $log -Append -Encoding utf8

net stop winnat 2>&1 | Out-File $log -Append -Encoding utf8
net start winnat 2>&1 | Out-File $log -Append -Encoding utf8

"--- excludedportrange after fix ---" | Out-File $log -Append -Encoding utf8
netsh interface ipv4 show excludedportrange protocol=tcp 2>&1 | Out-File $log -Append -Encoding utf8
"=== DONE ===" | Out-File $log -Append -Encoding utf8
