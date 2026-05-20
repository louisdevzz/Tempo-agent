# 🤖 Tempo Worker Bot

Bot tự động gọi API trả phí bằng **USDC** qua **Tempo CLI**.  
Hoạt động theo ca, mỗi 30–120 phút chọn random 1 task, gọi API, lưu kết quả, tự check balance.

**Yêu cầu:** Windows 10/11, WSL2, Docker Desktop, 2GB RAM, 5GB disk.  
**Chi phí:** 1 worker ~$3–5 USDC cho 2–4 tuần.

---

## Quick start

```powershell
# 1. Clone repo
git clone https://github.com/YOUR_USERNAME/tempo-worker-bot.git
cd tempo-worker-bot

# 2. Build
docker compose build

# 3. Login ví Tempo (mở URL trong browser → đăng nhập Google)
docker compose run --rm -it worker-01 tempo wallet login

# 4. Verify
docker compose run --rm worker-01 tempo wallet -t whoami
docker compose run --rm worker-01 tempo wallet -t balance

# 5. Start
docker compose up -d worker-01
docker compose logs -f worker-01
```

---

## Mục lục

1. [Cài đặt môi trường](#1-cài-đặt-môi-trường)
2. [Tạo ví Tempo + nạp USDC](#2-tạo-ví-tempo--nạp-usdc)
3. [Clone & chạy bot](#3-clone--chạy-bot)
4. [Cấu hình scheduler](#4-cấu-hình-scheduler)
5. [Giám sát](#5-giám-sát)
6. [Thêm worker mới](#6-thêm-worker-mới)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Cài đặt môi trường

### Bật WSL2 (PowerShell Admin)

```powershell
wsl --install
# Khởi động lại máy
wsl --set-default-version 2
```

### Cài Docker Desktop

- Tải từ [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
- Cài đặt → chọn ✅ **"Use WSL 2 instead of Hyper-V"**
- Khởi động lại máy

### Cài Git + verify

```powershell
winget install Git.Git
# Đóng PowerShell, mở lại rồi chạy:
git --version
docker --version
docker compose version
```

> **Lỗi thường gặp:**
> | Lỗi | Fix |
> |---|---|
> | `WSL 2 installation is incomplete` | `wsl --install` trong PowerShell Admin |
> | `Hardware virtualization must be enabled` | Vào BIOS bật Intel VT-x / AMD-V |
> | `Cannot connect to Docker daemon` | Mở Docker Desktop, chờ "Running" |
> | `git` không nhận sau khi cài | Đóng PowerShell, mở lại cửa sổ mới |

---

## 2. Tạo ví Tempo + nạp USDC

1. Vào [wallet.tempo.xyz](https://wallet.tempo.xyz) → Sign in with Google
2. Copy địa chỉ ví `0x...`
3. Nạp **$3–5 USDC** qua mạng **Base** (rẻ) hoặc **Optimism**
4. Withdraw từ Binance/Coinbase/OKX → chọn mạng Base → dán địa chỉ ví

> **Mỗi Google Account = 1 ví Tempo.** Nhiều worker → nhiều Google Account.

---

## 3. Clone & chạy bot

```powershell
# Clone
git clone https://github.com/YOUR_USERNAME/tempo-worker-bot.git
cd tempo-worker-bot

# Build image (lần đầu ~3–5 phút)
docker compose build

# Login ví (terminal hiện URL → mở browser → đăng nhập Google)
docker compose run --rm -it worker-01 tempo wallet login

# Verify
docker compose run --rm worker-01 tempo wallet -t whoami
docker compose run --rm worker-01 tempo wallet -t balance

# Test manual 1 call (tuỳ chọn)
docker compose run --rm worker-01 tempo request -t -X POST `
  --json '{\"query\":\"bitcoin\",\"num_results\":1}' `
  "https://exa.mpp.tempo.xyz/search"

# Start
docker compose up -d worker-01
docker compose logs -f worker-01
```

---

## 4. Cấu hình scheduler

Mở file `scripts/scheduler.mjs`, sửa phần **CẤU HÌNH** ở đầu file:

### Interval (thời gian chờ giữa các task)

```javascript
const WORKER_PROFILES = {
  'worker-01': { minInterval: 30, maxInterval: 120, startupDelay: 0 },
  'worker-02': { minInterval: 30, maxInterval: 120, startupDelay: [10, 25] },
};
```

### Khung giờ hoạt động (UTC+7)

```javascript
const WORKER_SCHEDULE = {
  'worker-01': { start: 8,  end: 17 },  // Ca ngày: 8h → 17h
  'worker-02': { start: 17, end: 3  },  // Ca đêm: 17h → 3h sáng
};
```

| Config | Ý nghĩa |
|---|---|
| `minInterval / maxInterval` | Chờ random N phút giữa các task |
| `startupDelay` | Chờ trước task đầu tiên (phút hoặc `[min, max]`) |
| `start / end` | Khung giờ. `start > end` = ca đêm (qua ngày) |

### Ngưỡng balance

```javascript
const BALANCE_WARN = 0.50;   // Cảnh báo khi < $0.50
const BALANCE_STOP = 0.30;   // Tạm dừng khi < $0.30
```

### Thêm endpoints

Sửa `scripts/tasks-worker-01.json`. Tìm thêm endpoints tại [mpp.dev/services](https://mpp.dev/services).

| Trường | Ý nghĩa |
|---|---|
| `id` | Tên file kết quả: `{id}-{timestamp}.json` |
| `method` | `POST` hoặc `GET` |
| `url` | Endpoint API qua Tempo MPP |
| `payload` | Request body |
| `randomize` | Mỗi call chọn random 1 value. Nested: `messages.0.content` |
| `pollJob` | *(tuỳ chọn)* `true` nếu API trả `jobId` cần polling |

---

## 5. Giám sát

```powershell
# Xem kết quả
docker compose run --rm worker-01 node scripts/check-log.mjs all
docker compose run --rm worker-01 node scripts/check-log.mjs worker-01

# Check balance
docker compose run --rm worker-01 tempo wallet -t balance

# Log Docker
docker compose logs -f worker-01
docker compose logs --tail=50 worker-01
docker compose logs worker-01 | Select-String "Error|FAIL"

# Stop / Restart
docker compose stop worker-01
docker compose restart worker-01
docker compose down                  # giữ volume ví
# ⚠️ ĐỪNG: docker compose down -v   ← xóa cả ví

# Login lại khi token hết hạn
docker compose stop worker-01
docker compose run --rm -it worker-01 tempo wallet login
docker compose up -d worker-01
```

---

## 6. Thêm worker mới

**Checklist** (ví dụ thêm worker-02):

- [ ] Google Account mới + ví [wallet.tempo.xyz](https://wallet.tempo.xyz) + nạp $3–5 USDC
- [ ] Thêm vào `config/workers.json` (copy worker-01, đổi id/port/dirs)
- [ ] Copy tasks: `cp scripts/tasks-worker-01.json scripts/tasks-worker-02.json`
- [ ] Thêm profile + schedule vào `scripts/scheduler.mjs`
- [ ] Thêm service + volume vào `docker-compose.yml`:

```yaml
  worker-02:
    build: .
    working_dir: /app
    command: ["node", "scripts/scheduler.mjs"]
    restart: unless-stopped
    volumes:
      - ./:/app
      - tempo-wallet-02:/root/.tempo
    environment:
      - WORKER_ID=worker-02
      - TEMPO_HOME=/root/.tempo
      - TZ=Asia/Bangkok

volumes:
  tempo-wallet-01:
  tempo-wallet-02:
```

```powershell
docker compose run --rm -it worker-02 tempo wallet login
docker compose run --rm worker-02 tempo wallet -t whoami
docker compose up -d worker-02
docker compose logs -f worker-02
```

---

## 7. Troubleshooting

| Triệu chứng | Fix |
|---|---|
| `Cannot connect to Docker daemon` | Mở Docker Desktop, chờ "Running" |
| `tempo: command not found` | `docker compose build --no-cache` |
| `unauthorized` / `not logged in` | Login lại ví |
| Balance quá thấp, bot tạm dừng | Nạp USDC qua wallet.tempo.xyz |
| Container crash | Check log + validate tasks JSON |
| Tất cả tasks fail | Test manual 1 endpoint |
| `ENOENT: no such file` | Tạo `scripts/tasks-worker-XX.json` |

---

## Cấu trúc project

```
tempo-worker-bot/
├── config/
│   └── workers.json              ← Định nghĩa workers
├── scripts/
│   ├── scheduler.mjs             ← Core logic (vòng lặp chính)
│   ├── check-log.mjs             ← Xem kết quả
│   ├── relogin.mjs               ← Login lại ví
│   └── tasks-worker-01.json      ← Tasks cho worker-01
├── runtime/                      ← Tự tạo khi chạy (đã gitignore)
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

---

## License

MIT
