# Deploying to AWS (EC2)

Same idea as the Google Cloud guide — a small always-on VM (EC2 instance), since the bot needs a persistent filesystem for its keystore/targets/schedules. No inbound ports needed; the bot only makes outbound connections.

## 1. Launch the instance
In the AWS Console:
1. Go to **EC2** > **Instances** > **Launch instances**.
2. Name: `telegram-nft-bot`.
3. AMI: **Ubuntu Server 24.04 LTS** (or Debian — either works).
4. Instance type: **t3.small** is plenty (2 vCPU burst, 2GB RAM). `t3.micro` also works and is free-tier eligible for the first 12 months on a new AWS account, but is a bit tight on memory.
5. Key pair: create a new one if you don't have one — this is what lets you SSH in. Download the `.pem` file and keep it somewhere safe, it can't be re-downloaded.
6. Network settings: leave the default VPC/subnet. Under firewall (security group) rules, only **SSH (port 22)** needs to be open, restricted to "My IP" if the option is offered — the bot itself needs no inbound rules at all.
7. Storage: default 8-20GB is plenty.
8. Click **Launch instance**.

## 2. Connect
Easiest: select the instance in the console, click **Connect**, use the **EC2 Instance Connect** tab (opens a browser terminal, no local SSH client or key file needed).

Or from your own terminal, if you downloaded the `.pem` key:
```
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<the instance's public IP>
```

## 3. Install Node.js
On the instance:
```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

## 4. Upload the project
From your local machine (not the instance), using the same `.pem` key:
```
scp -i your-key.pem -r telegram-nft-bot ubuntu@<instance-ip>:/tmp/telegram-nft-bot
```
If you connected via the browser-based EC2 Instance Connect instead and don't have the `.pem` file handy locally, an easier path is: zip the project, upload it somewhere you can `curl`/`wget` from the instance (e.g. a private Cloud Storage/S3 bucket URL, or even just re-download the zip from this chat if you have a shareable link), then unzip on the instance directly.

Then on the instance:
```
sudo mkdir -p /opt/telegram-nft-bot
sudo mv /tmp/telegram-nft-bot/* /opt/telegram-nft-bot/
sudo useradd --system --home /opt/telegram-nft-bot node || true
sudo chown -R node:node /opt/telegram-nft-bot
```

## 5. Install dependencies and configure
```
cd /opt/telegram-nft-bot
sudo -u node npm install
sudo -u node npm run build
sudo -u node cp .env.example .env
sudo -u node nano .env   # fill in your real values, same as local setup
```

## 6. Import or generate wallets
```
sudo -u node npm run import-wallet -- --chain evm --label main --key 0x...
```
or generate one via Telegram once the bot is running (`/newwallet evm main`).

## 7. Install the systemd service
Same service file as the Google Cloud guide — Ubuntu/Debian both use systemd.
```
sudo cp deploy/telegram-nft-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable telegram-nft-bot
sudo systemctl start telegram-nft-bot
sudo systemctl status telegram-nft-bot
journalctl -u telegram-nft-bot -f
```

## Security notes specific to AWS
- The `.pem` key file is the only way to SSH in (password auth is disabled by default on these AMIs) — losing it means losing that access path; leaking it means anyone with it can reach the instance, and therefore the running bot's key material.
- Keep the security group locked to SSH-only, ideally restricted to your own IP rather than "anywhere" (0.0.0.0/0).
- Same caveat as the Google Cloud guide: whoever can SSH into this instance while the bot is running has effective access to decrypted key material in memory. Treat instance access as equivalent to wallet access.
- AWS EBS volumes are encrypted at rest if you enabled that at launch (worth checking) — again, a nice extra layer, not a substitute for the app-level keystore encryption.
