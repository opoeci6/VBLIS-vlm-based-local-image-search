# Running VBLIS as a server

VBLIS can serve its interface to web browsers on other devices: a laptop, a tablet, a phone. The server does the indexing and searching; the browser only shows results. Everything still stays on your own machines.

> [!NOTE]
> This guide covers the server you start from a command line (Linux, or Windows without the desktop app). A "Share on my network" switch in the Windows app comes in a later version.

## Who can do what

Everyone signs in with their own **account**: a name and a password. Each account is an **owner** or a **viewer**, and the owner sets what each viewer may do:

| | Owner | Viewer |
|---|---|---|
| Search, browse, filters, full-size view | yes | yes |
| Search with a picture | yes | if allowed for that account (on for a new account) |
| Place names and the Place filter | yes | if allowed for that account (on for a new account) |
| Open or download original files | yes | if allowed for that account (off for a new account; otherwise a resized copy without location data is shown) |
| Add, re-sync and remove folders | yes | no |
| Models, queue, caches, server settings, accounts | yes | no |

Names have up to 32 letters or digits (any language) and may use `.`, `_` and `-`; upper and lower case count as the same name. Passwords have at least 8 characters. There can be several owners; at least one has to stay. Every account can change its own password under **Settings**.

In **Manage accounts**, a change that gives someone access (adding an account, a new password, turning a permission or an account on, a new name or role) asks for your own password. After you enter it, changes to viewers don't ask again for 5 minutes, in the same browser sign-in from the same address. Anything that could give someone owner access or lock you out always asks: adding an owner, making an account an owner, turning an owner back on, setting an owner's password, and any change to your own account. Signing out ends the 5 minutes early.

Original files keep the location data the camera wrote. So a viewer with **Originals** on can still read where a photo was taken from a downloaded file, even with **Places** off.

A browser can only index folders inside the **library folders** you list in the server settings, so nobody can reach other folders through the browser.

## Install on Linux

Requirements: a 64-bit Linux (x86-64 or ARM64) with Python 3.11 to 3.13 and `python3-venv` (on Debian or Ubuntu: `sudo apt install python3-venv python3-pip`), about 3 GB of disk for the program, plus the models (0.6 to 4.3 GB each) and the index. An NVIDIA GPU is optional.

```bash
git clone https://github.com/opoeci6/VBLIS-vlm-based-local-image-search.git vblis
cd vblis
scripts/install-linux.sh                # CPU; add --torch cuda for an NVIDIA GPU (x86-64)
```

The script builds a private Python environment in `api/.venv` (nothing is installed system-wide), keeps your data in `~/.local/share/vblis` (`--data-dir` changes that), and writes a systemd user service. It needs the built web interface in `app/dist`: it builds it when Node.js 22 is installed. Without Node.js, download `VBLIS-web-<version>.zip` from the release page and give it to the script with `--web-zip`:

```bash
scripts/install-linux.sh --web-zip VBLIS-web-<version>.zip
```

The script checks the zip and replaces `app/dist` with it. You can also build the interface on any machine with `cd app && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm run build` and copy `app/dist` over.

Then, with `vblis` standing for `api/.venv/bin/python api/main.py --data-dir ~/.local/share/vblis`:

```bash
vblis add-account alice --role owner           # asks for the password twice
vblis add-account bob --role viewer            # optional; or add viewers later in the browser
vblis add-library-folder /srv/photos           # one or more
vblis serve                                    # or: systemctl --user enable --now vblis
```

Open `http://<the server's address>:8080` in a browser, sign in with the owner account, download a model in **Settings**, and add folders with **Add Folders**. **Settings → Manage accounts** adds more accounts and sets each viewer's permissions.

To keep the service running after you log out: `sudo loginctl enable-linger $USER`.

## Docker

The `deploy` folder has a `Dockerfile` and a `compose.yml`. The image holds the program only. Your models, the index and the settings live in a folder you mount at `/data`, so you can rebuild the image without losing them.

First run, in the `deploy` folder:

```bash
mkdir vblis-data
sudo chown 1000:1000 vblis-data                       # the container runs as user 1000
export VBLIS_PHOTOS=/srv/photos                       # your pictures (the default is deploy/photos)
docker compose build
docker compose run --rm vblis add-account alice --role owner     # asks for the password twice
docker compose up -d
```

If you would rather run the container as yourself, skip the `chown` and set `VBLIS_UID=$(id -u)` and `VBLIS_GID=$(id -g)` instead. Keep them set for every later `docker compose` command.

Open `http://<the server's address>:8080`, sign in, and download a model in **Settings**. The models are downloaded from the browser into `/data/models` (the `vblis-data/models` folder). Nothing is downloaded while the image is built.

The photo folder is mounted read-only at `/photos`, and it is the library folder: browsers can index it and everything inside it. To list other folders, mount them and set `VBLIS_SERVER_LIBRARY_ROOTS` in `compose.yml` (separated by `:`).

Other commands work the same way, for example `docker compose run --rm vblis show-config` or `docker compose run --rm vblis add-account bob --role viewer`.

### Settings

Settings are kept in `vblis-data/data/server.json`, as on any other install. A `.env` file in `vblis-data` can set other values, such as `ACTIVE_MODEL`.

The `VBLIS_SERVER_*` variables listed under Settings below work in `compose.yml` under `environment`. A field set this way wins over the file, and the interface shows it as locked: change the variable and run `docker compose up -d` again.

### Networking

`compose.yml` uses host networking (`network_mode: host`). The server then sees each client's real address and the machine's real host name and network addresses, as it would outside Docker. The port is the one in the settings (8080 by default). Host networking works on Linux only.

With bridge networking (the commented lines in `compose.yml`), the host name inside the container is the container id, and the server sees Docker's gateway address instead of each client. List the names and addresses browsers use in `VBLIS_SERVER_ALLOWED_HOSTS` (for example `nas.lan,192.168.1.20`). Because every client then looks local, do not open the port to the internet in this mode.

### Behind a reverse proxy

Run the proxy on the same machine, let VBLIS listen on the loopback address only, and trust the proxy: set `VBLIS_SERVER_HOST=127.0.0.1`, `VBLIS_SERVER_TRUSTED_PROXIES=127.0.0.1` and `VBLIS_SERVER_ALLOWED_HOSTS=photos.example.com`. This needs host networking. Add `VBLIS_SERVER_PUBLIC_ACCESS=true` only if clients come from the internet, and only with HTTPS at the proxy. See [HTTPS](#https) and [Access from outside your home](#access-from-outside-your-home) below.

### Updating and stopping

To update, pull the new version of the repository and run `docker compose build && docker compose up -d` in the `deploy` folder. Your data stays in `vblis-data`.

Stopping usually takes a second or two; while indexing it can take longer, because the server finishes the current step and stops its queue first. Compose waits up to 30 seconds before it forces the container to stop. Signed-in browsers stay signed in across a restart.

### What was tested

The image was tested on ARM64 (Ubuntu 26.04 with Docker 29): the image is about 1.9 GB, the server uses about 280 MB of memory before a model is loaded and about 470 MB with the CLIP base model. It should work on x86-64 but that is untested. A GPU (CUDA) is not tested: `docker compose build --build-arg TORCH=cuda` is x86-64 only and also needs the NVIDIA container toolkit.

## On Windows, without the desktop app

From a source checkout with the web interface built (`cd app && npm ci && npm run build`): `api\.venv\Scripts\python.exe api\main.py --data-dir D:\VBLIS-server serve`, and the same `add-account` and other commands as above. `VBLIS_WEB_DIR` can point at another copy of the built interface.

Only one VBLIS backend can use a data folder at a time. Pointing the server at the desktop app's data (`%LOCALAPPDATA%\VBLIS`) works while the desktop app is closed. Windows asks once whether to let the program through the firewall; allow it on private networks.

## Settings

The settings live in `data/server.json` inside the data folder. Change them with the commands below (a running server picks the change up within a second), or edit the file while the server is stopped.

| Command | Meaning |
|---|---|
| `add-account NAME --role owner\|viewer` | Add an account (the password is asked twice; `--stdin` reads one line for scripts). |
| `set-password NAME` | A new password for that account; its browsers are signed out. |
| `rename-account NAME NEW_NAME` / `set-role NAME owner\|viewer` | Rename (the account stays signed in) or change the role. |
| `allow NAME originals\|image_search\|places on\|off` | What that viewer may do: open and download originals, search with a picture, see place names. |
| `disable-account NAME` / `enable-account NAME` / `remove-account NAME` | Turn an account off (it can't sign in, its browsers are signed out), on again, or delete it. The last owner can't be turned off, demoted or deleted. |
| `sign-out NAME` | That account has to sign in again in every browser. |
| `list-accounts` | The accounts, their roles and permissions. |
| `add-library-folder PATH` / `remove-library-folder PATH` | Folders a browser may index (and everything inside them). |
| `set port 8080` | The port (never 8000; the desktop app uses it). |
| `set host 0.0.0.0` | The address to listen on: `0.0.0.0` (all IPv4), `::` (IPv4 and IPv6), or one address. |
| `set tls off\|self_signed\|files` | HTTPS; see below. `set cert-file PATH` and `set key-file PATH` for `files`. |
| `set allowed-hosts photos.example.com,nas.lan` | Extra host names browsers may use. The machine's own name, `<name>.local`, `localhost` and any IP address always work. |
| `set trusted-proxies 127.0.0.1` | Reverse proxies whose `X-Forwarded-For` and `X-Forwarded-Proto` headers are believed. |
| `set public-access true` | Allow clients from the internet; needs HTTPS. |
| `sign-out-everywhere` | Every browser has to sign in again. |
| `show-config` | Print the settings and the accounts (never the passwords). |

An owner can do the same in the browser, under **Settings → Manage accounts**. Everything that gives access asks for that owner's own password again: adding an account, renaming, changing a role or a password, deleting, turning an owner on or off, turning any account back on, and switching a viewer's permission on. A browser left signed in then can't be used to make a lasting way in or to widen anyone's access. Switching a permission off, turning a viewer off and signing an account out happen at once.

A permission that isn't `true` or `false` in a hand-edited `server.json` counts as off.

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

- Viewers see file and folder names (they are part of every search result), and, with **Places** on, place names from the GPS data of photos.
- A browser remembers the sign-in for 30 days. Changing a password signs that account out everywhere.
- Names typed in full-width letters (as a Chinese or Japanese input method may) count as the same name in normal letters.
- Each browser keeps its own interface settings (theme, language, search sliders).
- The server keeps working when no browser is open; indexing continues in the background.
- Files and folders whose names aren't valid UTF-8 (possible on Linux) are skipped, by the folder picker and by indexing; the server log names the folder that holds them. Rename them to include them.
- On Linux, indexing skips hidden folders (names starting with a dot), `@eaDir` (Synology thumbnails) and `lost+found`, and folder names that differ only in case are different folders.
