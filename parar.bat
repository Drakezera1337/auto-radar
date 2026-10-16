@echo off
rem Para o servidor do Auto Radar (que roda sem janela)
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force; Write-Host 'Auto Radar parado.' } else { Write-Host 'O Auto Radar nao estava rodando.' }"
timeout /t 3 >nul
