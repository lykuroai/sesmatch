# Jitsi（meet.lykuro.ai）のカスタマイズファイル

データノード `/data/jitsi/cfg/web/` に置いているファイルの写し（正はサーバー側。変更したら両方を更新する）。全体の手順は `../JITSI-EC2.md`。

| ファイル | 配置先 | 役割 |
| --- | --- | --- |
| `custom-interface_config.js` | `cfg/web/custom-interface_config.js` | 既定の `interface_config.js` の末尾に連結。タブ名・提供者名、左上ロゴ（`DEFAULT_LOGO_URL`＝`/custom/logo-wordmark-dark.svg`）、Jitsi 表記の非表示 |
| `custom-config.js` | `cfg/web/custom-config.js` | 既定の `config.js` の末尾に連結（外部への問い合わせ無効） |
| `custom-meet.conf` | `cfg/web/nginx/custom-meet.conf` | Jitsi web の nginx `meet.conf` の末尾に連結。`/custom/` の静的配信と、ロゴ枠を広げた `/css/all.css` の差し替え |
| `custom.css` | `cfg/web/custom-static/custom.css` | ロゴ枠（既定 71×32px）を 236×40px に広げる上書き。`all.css`（既定の CSS＋この内容）を生成して配信する |
| `logo-wordmark-dark.svg` | `cfg/web/custom-static/logo-wordmark-dark.svg` | 横長ロゴ（マーク＋SES DirectMatch、暗い背景用） |
| `lykuro-nginx-vhost-meet.conf` | lykuro の `/data/lykuro/src/docker/nginx/default.conf` 末尾 | ALB → lykuro-nginx → Jitsi web の vhost |

`all.css` の再生成（Jitsi を更新したら必ずやり直す）:

```bash
cd /data/jitsi/cfg/web
docker exec jitsi-web-1 cat /usr/share/jitsi-meet/css/all.css > custom-static/all.css
printf "\n" >> custom-static/all.css && cat custom-static/custom.css >> custom-static/all.css
cd /data/jitsi/docker-jitsi-meet-stable-11248-3 && docker compose --env-file /data/jitsi/.env -p jitsi up -d --force-recreate web
```
