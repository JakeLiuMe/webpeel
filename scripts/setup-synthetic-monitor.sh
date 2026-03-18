#!/bin/bash
# Install synthetic monitoring on Hetzner — runs every 5 min
HETZNER_HOST="${1:-178.156.229.86}"

scp scripts/synthetic-monitor.sh root@${HETZNER_HOST}:/opt/webpeel-synthetic.sh
ssh root@${HETZNER_HOST} "
chmod +x /opt/webpeel-synthetic.sh
# Install cron (every 5 min)
CRON='*/5 * * * * WEBPEEL_API_KEY=wp_live_c3b96132838b06d1e9ecb69f540f8381 /opt/webpeel-synthetic.sh >> /var/log/webpeel-synthetic.log 2>&1'
(crontab -l 2>/dev/null | grep -v webpeel-synthetic; echo \"\$CRON\") | crontab -
echo '✅ Synthetic monitor installed (every 5 min)'
crontab -l | grep synthetic
"
