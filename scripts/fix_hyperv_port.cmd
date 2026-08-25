@echo off
rem One-shot: move Windows TCP/UDP dynamic port range to IANA standard (49152-65535)
rem so the Hyper-V reserved block (10548-10647) no longer covers port 10588.
rem Previous values: tcp start=10000 num=55536, udp start=10000 num=55536
netsh int ipv4 set dynamic tcp start=49152 num=16384
netsh int ipv4 set dynamic udp start=49152 num=16384
net stop winnat >nul 2>&1
net start winnat >nul 2>&1
exit /b 0
