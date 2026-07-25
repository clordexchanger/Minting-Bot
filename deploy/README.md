# Deploying to Google Cloud (Compute Engine)

The bot stores its encrypted keystore, targets, and schedules as local files, so it needs a persistent filesystem — Compute Engine (a regular VM) is the right fit, not Cloud Run or other stateless/serverless options.

No inbound firewall rules are needed. The bot only makes outbound connections (Telegram, Alchemy, RPCs) — it never listens for incoming traffic.

## 1. Create the VM
In the Google Cloud Console (or `gcloud`), create an instance:
- Machine type: `e2-small` is plenty (2 vCPU burst, 2GB RAM) — this bot is not compute-heavy. `e2-micro` also works and may be free-tier eligible in some regions, but is a bit tight on memory.
- Boot disk: Debian or Ubuntu, default size is fine.
- Region: pick one close to your RPC providers for lower latency. `us-east1` or `us-central1` are solid defaults for Alchemy's primary US infrastructure.
- Leave firewall options unchecked (no HTTP/HTTPS needed) — the bot doesn't serve anything.

```
gcloud compute instances create telegram-nft-bot \
  --machine-type=e2-small \
  --zone=us-east1-b \
  --image-family=debian-12 \
  --image-project=debian-cloud
```

## 2. SSH in and install Node.js
```
gcloud compute ssh telegram-nft-bot --zone=us-east1-b
```
Then on the VM:
```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # confirm it's installed
```

## 3. Upload the project
From your local machine (not the VM):
```
gcloud compute scp --recurse telegram-nft-bot gcloud-user@telegram-nft-bot:/tmp/telegram-nft-bot --zone=us-east1-b
```
Then on the VM, move it into place and set ownership:
```
sudo mkdir -p /opt/telegram-nft-bot
sudo mv /tmp/telegram-nft-bot/* /opt/telegram-nft-bot/
sudo useradd --system --home /opt/telegram-nft-bot node || true
sudo chown -R node:node /opt/telegram-nft-bot
```

## 4. Install dependencies and configure
```
cd /opt/telegram-nft-bot
sudo -u node npm install
sudo -u node npm run build
sudo -u node cp .env.example .env
sudo -u node nano .env   # fill in your real values, same as local setup
```
Same `.env` requirements as running locally — bot token, operator ID, RPC URLs, keystore passphrase.

## 5. Import or generate wallets
Either works the same as local:
```
sudo -u node npm run import-wallet -- --chain evm --label main --key 0x...
```
or generate one via Telegram once the bot is running (`/newwallet evm main`).

## 6. Install the systemd service
```
sudo cp deploy/telegram-nft-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable telegram-nft-bot
sudo systemctl start telegram-nft-bot
```
Check it's running:
```
sudo systemctl status telegram-nft-bot
journalctl -u telegram-nft-bot -f
```
`enable` means it starts automatically on VM reboot. `Restart=always` in the service file means it comes back up if the process crashes.

## Updating later
```
gcloud compute scp --recurse telegram-nft-bot gcloud-user@telegram-nft-bot:/tmp/telegram-nft-bot-update --zone=us-east1-b
```
Then on the VM, copy over just the `src/`, `scripts/`, `package.json` (not `.env` or `data/` — those hold your real config and keys):
```
sudo systemctl stop telegram-nft-bot
sudo cp -r /tmp/telegram-nft-bot-update/src /opt/telegram-nft-bot/
sudo cp -r /tmp/telegram-nft-bot-update/scripts /opt/telegram-nft-bot/
sudo cp /tmp/telegram-nft-bot-update/package.json /opt/telegram-nft-bot/
cd /opt/telegram-nft-bot && sudo -u node npm install && sudo -u node npm run build
sudo systemctl start telegram-nft-bot
```

## Security notes specific to running remotely
- `.env` and `data/keystore.enc.json` never leave this VM unless you explicitly copy them — treat SSH access to this VM as equivalent to holding the wallet keys.
- Restrict SSH access: use [OS Login](https://cloud.google.com/compute/docs/oslogin) or IAP tunneling instead of a broadly-open SSH firewall rule, and don't reuse this VM for anything else.
- The keystore passphrase in `.env` is still the only thing standing between the encrypted file and the raw keys — same as running locally, losing it means losing access to imported/generated wallets.
- Google Cloud's disks are encrypted at rest by default, which is a nice extra layer, but doesn't replace the app-level encryption — someone with root on the VM while it's running could still access decrypted key material in memory, same as on any machine actively running the bot.
