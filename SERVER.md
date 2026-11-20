# Running VBLIS as a server

VBLIS can serve its interface to web browsers on other devices: a laptop, a tablet, a phone. The server does the indexing and searching; the browser only shows results. Everything still stays on your own machines.

> [!NOTE]
> This guide covers the server you start from a command line (Linux, or Windows without the desktop app). A "Share on my network" switch in the Windows app comes in a later version.

## Who can do what

The server has two passwords:

| | Owner | Viewer |
|---|---|---|
| Search, browse, filters, full-size view | yes | yes |
| Search with a picture | yes | if the owner allows it (on by default) |
| Open or download original files | yes | if the owner allows it (off by default; otherwise a resized copy without location data is shown) |
| Add, re-sync and remove folders | yes | no |
| Models, queue, caches, server settings | yes | no |

The viewer password is optional; without one, only the owner can sign in. Owner and viewer passwords must be different, and at least 8 characters long.

A browser can only index folders inside the **library folders** you list in the server settings, so nobody can reach other folders through the browser.

## Install on Linux

Requirements: a 64-bit Linux (x86-64 or ARM64) with Python 3.11 to 3.13 and `python3-venv` (on Debian or Ubuntu: `sudo apt install python3-venv python3-pip`), about 3 GB of disk for the program, plus the models (0.6 to 4.3 GB each) and the index. An NVIDIA GPU is optional.

```bash
git clone https://github.com/opoeci6/VBLIS-vlm-based-local-image-search.git vblis
cd vblis
scripts/install-linux.sh                # CPU; add --torch cuda for an NVIDIA GPU (x86-64)
```

The script builds a private Python environment in `api/.venv` (nothing is installed system-wide), keeps your data in `~/.local/share/vblis` (`--data-dir` changes that), and writes a systemd user service. It needs the built web interface in `app/dist`: it builds it when Node.js 22 is installed, otherwise build it on any machine with `cd app && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm run build` and copy `app/dist` over.

Then, with `vblis` standing for `api/.venv/bin/python api/main.py --data-dir ~/.local/share/vblis`:

```bash
vblis set-password owner
vblis set-password viewer                      # optional
vblis add-library-folder /srv/photos           # one or more
vblis serve                                    # or: systemctl --user enable --now vblis
```

Open `http://<the server's address>:8080` in a browser, sign in as the owner, download a model in **Settings**, and add folders with **Add Folders**.

To keep the service running after you log out: `sudo loginctl enable-linger $USER`.

## On Windows, without the desktop app

From a source checkout with the web interface built (`cd app && npm ci && npm run build`): `api\.venv\Scripts\python.exe api\main.py --data-dir D:\VBLIS-server serve`, and the same `set-password` and other commands as above. `VBLIS_WEB_DIR` can point at another copy of the built interface.

Only one VBLIS backend can use a data folder at a time. Pointing the server at the desktop app's data (`%LOCALAPPDATA%\VBLIS`) works while the desktop app is closed. Windows asks once whether to let the program through the firewall; allow it on private networks.

## Settings

The settings live in `data/server.json` inside the data folder. Change them with the commands below (a running server picks the change up within a second), or edit the file while the server is stopped.

| Command | Meaning |
|---|---|
| `set-password owner` / `set-password viewer` | Set a password (asked twice; `--stdin` reads one line for scripts). Browsers signed in with the old password are signed out. |
| `remove-viewer-password` | Viewers can no longer sign in. |
| `add-library-folder PATH` / `remove-library-folder PATH` | Folders a browser may index (and everything inside them). |
| `allow-viewer originals on\|off` | Viewers may open and download original files. |
| `allow-viewer image_search on\|off` | Viewers may search with a picture. |
| `set port 8080` | The port (never 8000; the desktop app uses it). |
| `set host 0.0.0.0` | The address to listen on: `0.0.0.0` (all IPv4), `::` (IPv4 and IPv6), or one address. |
| `set tls off\|self_signed\|files` | HTTPS; see below. `set cert-file PATH` and `set key-file PATH` for `files`. |
| `set allowed-hosts photos.example.com,nas.lan` | Extra host names browsers may use. The machine's own name, `<name>.local`, `localhost` and any IP address always work. |
| `set trusted-proxies 127.0.0.1` | Reverse proxies whose `X-Forwarded-For` and `X-Forwarded-Proto` headers are believed. |
| `set public-access true` | Allow clients from the internet; needs HTTPS. |
| `sign-out-everywhere` | Every browser has to sign in again. |
| `show-config` | Print the settings (never the passwords). |

The owner can also change the viewer's permissions and both passwords in the browser, under **Settings**.

For Docker or systemd, these environment variables override the file: `VBLIS_SERVER_HOST`, `VBLIS_SERVER_PORT`, `VBLIS_SERVER_TLS`, `VBLIS_SERVER_CERT_FILE`, `VBLIS_SERVER_KEY_FILE`, `VBLIS_SERVER_LIBRARY_ROOTS` (separated by `:` on Linux, `;` on Windows), `VBLIS_SERVER_ALLOWED_HOSTS`, `VBLIS_SERVER_TRUSTED_PROXIES` (comma-separated) and `VBLIS_SERVER_PUBLIC_ACCESS`.

## HTTPS

Over plain HTTP, anyone on the same network can read the password and the pictures as they travel. That is acceptable on a home network you trust; the interface shows a warning. Otherwise choose one of these:

1. **Self-signed certificate** (`set tls self_signed`). The server makes its own certificate on the first start, for its host name and current network addresses, and prints its SHA-256 fingerprint. Each browser shows a warning once; compare the fingerprint in the certificate details with the one the server printed, then continue. The certificate is kept, so the warning doesn't return, until it renews itself after about a year or the server gets a new network address.
2. **Your own certificate** (`set tls files`, `set cert-file /path/fullchain.pem`, `set key-file /path/privkey.pem`), for example from Let's Encrypt. Restart the server after renewing it.
3. **A reverse proxy** that handles HTTPS, such as Caddy. Let VBLIS listen on the proxy's machine only and trust it:

   ```bash
   vblis set host 127.0.0.1
   vblis set trusted-proxies 127.0.0.1
   vblis set allowed-hosts photos.example.com
   ```

   Caddyfile:

   ```
   photos.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

## Access from outside your home

By default the server refuses clients from outside private networks (home and office networks, VPN ranges such as Tailscale's, and the machine itself). The safest ways to reach it from elsewhere:

- **A VPN** such as Tailscale or WireGuard: the server sees a private address, and nothing is exposed to the internet.
- **An SSH tunnel:** `ssh -L 8080:127.0.0.1:8080 you@server`, then open `http://localhost:8080`.
- **The internet directly:** `set public-access true` with HTTPS (directly or through a trusted proxy). Prefer a reverse proxy for this; VBLIS limits sign-in attempts but has no other protection against floods of requests.

The server can't tell whether it is reachable from the internet (inside Docker or behind a router it only sees private addresses); it decides by the address of each client. A proxy on the same machine makes every client look local unless it is listed in `trusted-proxies`; VBLIS refuses requests that carry proxy headers from a proxy it doesn't trust.

## Good to know

- Viewers see file and folder names (they are part of every search result), and place names from the GPS data of photos.
- A browser remembers the sign-in for 30 days. Changing a password signs that role out everywhere.
- Each browser keeps its own interface settings (theme, language, search sliders).
- The server keeps working when no browser is open; indexing continues in the background.
- Files and folders whose names aren't valid UTF-8 (possible on Linux) are skipped, by the folder picker and by indexing; the server log names the folder that holds them. Rename them to include them.
- On Linux, indexing skips hidden folders (names starting with a dot), `@eaDir` (Synology thumbnails) and `lost+found`, and folder names that differ only in case are different folders.
