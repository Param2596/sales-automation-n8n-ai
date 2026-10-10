$body = @{ name="Paramjot Singh"; email="paramjot@acme.io"; company="RetroTerminal"; website="iristerminal.vercel.app"; service="MDR"; message="Need 24x7 SOC for 300 endpoints" } | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:5678/webhook/lead -Method Post -ContentType 'application/json' -Body $body
read-host