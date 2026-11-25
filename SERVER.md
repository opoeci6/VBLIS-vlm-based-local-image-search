# Running VBLIS as a server

VBLIS can serve its interface to web browsers on other devices: a laptop, a tablet, a phone. The server does the indexing and searching; the browser only shows results. Everything still stays on your own machines.

> [!NOTE]
> On Windows, the easiest way is the **Share on my network** switch in the desktop app: see [Share from the Windows app](#share-from-the-windows-app). The rest of this guide covers the server you start from a command line: on Linux, in Docker, or on Windows without the desktop app.

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

## Share from the Windows app

1. Open **Settings → Network sharing** in the VBLIS app.
2. Add at least one account with **Manage accounts**. A viewer account is enough, because the app itself acts as the owner. On the desktop this window never asks for your password.
3. Turn on **Share on my network**. Windows asks once whether to let VBLIS through the firewall: allow it on private networks.
4. On another device on the same network, open one of the addresses listed under **Addresses to open** (the most likely one first) and sign in.

The same section sets the port (8080 by default), HTTPS (self-signed by default, your own certificate files, or off; see [HTTPS](#https)) and the library folders, and has **Sign out every browser**. While sharing runs, the title bar shows a **Sharing** badge; it turns amber when sharing should be on but isn't running. Click it to open the settings.

Sharing lasts while the app is open and starts again the next time you open it. The app and the browsers share one library: indexing started in either shows up in both. The app listens on every network of the PC (`0.0.0.0`); the `set host` command (see [Settings](#settings)) changes that while the app is closed. Settings set by `VBLIS_SERVER_*` environment variables are shown locked.

## Install on Linux

Requirements: a 64-bit Linux (x86-64 or ARM64) with Python 3.11 to 3.13 and `python3-venv` (on Debian or Ubuntu: `sudo apt install python3-venv python3-pip`), about 3 GB of disk for the program, plus the models (0.6 to 4.3 GB each) and the index. An NVIDIA GPU is optional (x86-64 only; a GeForce GTX 16 or RTX 20-series card or newer, with NVIDIA driver 580 or newer).

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

Open `https://<the server's address>:8080` in a browser, sign in with the owner account, download a model in **Settings**, and add folders with **Add Folders**. The connection uses HTTPS with a certificate the server made itself, so the browser shows a warning on the first visit; see [HTTPS](#https) for how to continue. **Settings → Manage accounts** adds more accounts and sets each viewer's permissions.

To keep the service running after you log out: `sudo loginctl enable-linger $USER`.

## macOS (Apple Silicon, from source)

Requirements: a Mac with Apple Silicon and macOS 14 or newer. No admin rights, no Xcode and no Homebrew are needed.

In Terminal:

1. Download the source archive and unzip it. Replace `<branch>` with the branch name, for example `main`. GitHub names the unzipped folder after the branch, turning each `/` into `-`.

   ```bash
   curl -L -o vblis.zip https://github.com/opoeci6/VBLIS-vlm-based-local-image-search/archive/refs/heads/<branch>.zip
   unzip -q vblis.zip
   cd VBLIS-vlm-based-local-image-search-*/
   ```

2. Download `VBLIS-web-<version>.zip` from the latest release.
3. Install into a private Python environment (downloads a standalone Python 3.11 into `~/.local/share/vblis/python`):

   ```bash
   bash scripts/install-linux.sh --fetch-python --web-zip /path/to/VBLIS-web-<version>.zip
   ```

4. Add an owner account, allow your photo folders, and start the server (`serve`), as in [Install on Linux](#install-on-linux).
5. Open the address it prints. On the Mac itself, open `https://localhost:8080`.

Good to know on macOS:
- The Apple GPU (Metal / MPS) is used automatically.
- **Auto** precision runs in fp32 on the Apple GPU (an explicit fp16 choice is still honoured).
- The macOS firewall may ask whether to allow incoming connections; only other devices on your network need that.
- Video decoding runs on the CPU.
- On a shared Mac, start the install command with `PIP_NO_CACHE_DIR=1`, so pip leaves no download cache in `~/Library/Caches/pip`.
- macOS disks usually ignore upper and lower case in file and folder names, while VBLIS on macOS compares paths exactly.

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

Open `https://<the server's address>:8080`, sign in, and download a model in **Settings**. The connection uses HTTPS with a certificate the server made itself, so the browser shows a warning on the first visit; see [HTTPS](#https) for how to continue. The models are downloaded from the browser into `/data/models` (the `vblis-data/models` folder). Nothing is downloaded while the image is built.

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

The image was tested on ARM64 (Ubuntu 26.04 with Docker 29) with PyTorch 2.6.0; PyTorch 2.14.1 is not tested in Docker yet. The image is about 1.9 GB, the server uses about 280 MB of memory before a model is loaded and about 470 MB with the CLIP base model. It should work on x86-64 but that is untested. A GPU (CUDA) is not tested: `docker compose build --build-arg TORCH=cuda` is x86-64 only and also needs the NVIDIA container toolkit.

## On Windows, without the desktop app

From a source checkout with the web interface built (`cd app && npm ci && npm run build`): `api\.venv\Scripts\python.exe api\main.py --data-dir D:\VBLIS-server serve`, and the same `add-account` and other commands as above. `VBLIS_WEB_DIR` can point at another copy of the built interface.

Only one VBLIS backend can use a data folder at a time. Pointing the server at the desktop app's data (`%LOCALAPPDATA%\VBLIS`) works while the desktop app is closed. Windows asks once whether to let the program through the firewall; allow it on private networks.

## A copy of the index on another machine (replica mode)

A small machine (an Orange Pi or another single-board computer, a NAS, a server elsewhere) can search a library that the Windows app has indexed, without indexing anything itself. The PC writes its index into one file; the other machine imports it and serves it read-only.

1. **On the PC:** in **Settings** → **Library**, choose **Export for another device** and pick where to save the file. It holds the index, the media details (dates, sizes, places), the list of indexed folders and, if you leave the box ticked, the thumbnails. It also holds the full paths of your files and where your photos were taken, so keep it private. With the app closed, `main.py export-index FILE` does the same.
2. **Put the pictures on the other machine** with the same folders below each indexed folder: a copy (`rsync -a` keeps the file times), an external drive, or a network share.
3. **Import, with the server stopped.** Give one `--map` for each indexed folder of the PC, from its path on the PC to where it is now (`vblis` as in [Install on Linux](#install-on-linux)):

   ```bash
   systemctl --user stop vblis       # if the service runs
   vblis import-index library.vblis-export --map 'D:\Photos=/mnt/photos'
   ```

   In Docker, put the file into `vblis-data` and run `docker compose run --rm vblis import-index /data/library.vblis-export --map 'D:\Photos=/photos'`.

   The import rewrites every path through the map and reports how many items it took, which folders had no `--map`, and which files it could not find yet.
4. **Add an owner account if there is none, start the server, sign in, and download the model** the import names in **Settings**. Each model has its own index, so the copy needs the same model as the PC. A machine with 4 GB of memory cannot run so400m. Index the library with SigLIP 2 base or CLIP on the PC, and export that index.

**What a copy does:**
- **Works as usual:** search, browsing, filters, places, duplicates, and original files (as each account is allowed).
- **Refused:** indexing, adding or removing folders, reading media details, clearing the index, and switching to another model. The interface hides these and shows where the copy came from.
- **Belongs to the machine itself:** accounts, sharing settings, the thumbnail cache and GPU settings.

**To update the copy,** export again on the PC, stop the server and import the new file. It replaces the old copy.

**Two safeguards:**
- `import-index` refuses a data folder that holds an index made in that folder, so a mistyped `--data-dir` can't overwrite your PC's own library. Add `--force` only to replace such an index on purpose.
- `detach-replica` turns a copy into an ordinary index that can be indexed again; the next import replaces it.

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
| `set tls off\|self_signed\|files` | HTTPS (`self_signed` by default); see below. `set cert-file PATH` and `set key-file PATH` for `files`. |
| `set allowed-hosts photos.example.com,nas.lan` | Extra host names browsers may use. The machine's own name, `<name>.local`, `localhost` and any IP address always work. |
| `set trusted-proxies 127.0.0.1` | Reverse proxies whose `X-Forwarded-For` and `X-Forwarded-Proto` headers are believed. |
| `set public-access true` | Allow clients from the internet; needs HTTPS. |
| `set local-networks 203.0.113.0/24,198.51.100.7` | Other addresses or ranges that count as your local network (see [Access from outside your home](#access-from-outside-your-home)). An empty value (`""`) clears the list. |
| `sign-out-everywhere` | Every browser has to sign in again. |
| `show-config` | Print the settings and the accounts (never the passwords). |

An owner can do the same in the browser, under **Settings → Manage accounts**. Everything that gives access asks for that owner's own password again: adding an account, renaming, changing a role or a password, deleting, turning an owner on or off, turning any account back on, and switching a viewer's permission on. A browser left signed in then can't be used to make a lasting way in or to widen anyone's access. Switching a permission off, turning a viewer off and signing an account out happen at once.

A permission that isn't `true` or `false` in a hand-edited `server.json` counts as off.

For Docker or systemd, these environment variables override the file: `VBLIS_SERVER_HOST`, `VBLIS_SERVER_PORT`, `VBLIS_SERVER_TLS`, `VBLIS_SERVER_CERT_FILE`, `VBLIS_SERVER_KEY_FILE`, `VBLIS_SERVER_LIBRARY_ROOTS` (separated by `:` on Linux, `;` on Windows), `VBLIS_SERVER_ALLOWED_HOSTS`, `VBLIS_SERVER_TRUSTED_PROXIES` and `VBLIS_SERVER_LOCAL_NETWORKS` (comma-separated), and `VBLIS_SERVER_PUBLIC_ACCESS`.

## HTTPS

A new setup uses HTTPS with a self-signed certificate. Setups saved by VBLIS 0.7.0 or earlier keep plain HTTP until you change it; the Windows app then warns when sharing starts.

Over plain HTTP (`set tls off`), anyone on the same network can see the pictures as they travel and take over a signed-in session. Use it only on a network you fully trust; the interface shows a warning. The choices:

1. **Self-signed certificate** (`set tls self_signed`, the default). The server makes its own certificate on the first start, for its host name and current network addresses (on Linux, container and VM bridges such as `docker0` are left out), and prints its SHA-256 fingerprint. Each browser shows a warning once, because no public authority vouches for the certificate. To continue: in Chrome or Edge, **Advanced** → **Continue**; in Safari (iPhone, iPad, Mac), **Show Details** → **visit this website**; in Firefox, **Advanced** → **Accept the Risk and Continue**. To be sure it is your server, compare the fingerprint in the certificate details with the one the server printed (the Windows app shows it in **Settings** → **Network sharing**). The certificate is kept, so the warning doesn't return, until it renews itself after about a year or the server gets a new network address.
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

With HTTPS on (choices 1 and 2), a browser that opens `http://` on the server's port is sent on to `https://` on the same port, so typed addresses and old bookmarks keep working. The redirect is temporary (307) and the server sends no HSTS, so turning HTTPS off later leaves `http://` working again.

## Access from outside your home

By default the server refuses clients from outside private networks (home and office networks, VPN ranges such as Tailscale's, and the machine itself).

**A device on your own network is refused?** Some networks, such as a building's or a school's, show a device to the server with an address outside those ranges, for example a phone on the Wi-Fi while the server is on a cable. The refusal names the address the server saw ("This server sees your device as 203.0.113.7."), and so does the server's log. Add that address, or its range, to the other local networks: in the Windows app under **Settings → Network sharing → Other local networks**, or with `set local-networks`. It applies at once. Those devices are then treated like devices at home, so plain HTTP is allowed for them too. A range may be at most a /8 (IPv4) or a /32 (IPv6); for clients from anywhere, use public access instead.

The safest ways to reach the server from elsewhere:

- **A VPN** such as Tailscale or WireGuard: the server sees a private address, and nothing is exposed to the internet.
- **An SSH tunnel:** `ssh -L 8080:127.0.0.1:8080 you@server`, then open `https://localhost:8080` (or `http://` after `set tls off`: the tunnel already encrypts).
- **The internet directly:** `set public-access true` with HTTPS (directly or through a trusted proxy). Prefer a reverse proxy for this; VBLIS limits sign-in attempts but has no other protection against floods of requests.

The server can't tell whether it is reachable from the internet (inside Docker or behind a router it only sees private addresses); it decides by the address of each client. A proxy on the same machine makes every client look local unless it is listed in `trusted-proxies`; VBLIS refuses requests that carry proxy headers from a proxy it doesn't trust.

## On a phone

The interface fits a phone's screen. The search buttons sit in a row under the search box, **Filters** opens from the bottom of the screen, and windows such as Settings and the full-size view fill the screen. In the full-size view, swipe left or right to move between pictures (the arrow keys do the same on a computer). The phone's Back button closes the open window or view, one at a time.

## Good to know

- Viewers see file and folder names (they are part of every search result), and, with **Places** on, place names from the GPS data of photos.
- A browser remembers the sign-in for 30 days. Changing a password signs that account out everywhere.
- Passwords never leave the browser. To sign in or to confirm a change, the browser answers a one-time challenge from the server with a proof made from the password; a new password is sent already hashed (scrypt). So neither the network, even over plain HTTP, nor the browser's developer tools show a password. The server stores only scrypt hashes, and the browser checks the password length rules. A copy of `server.json` is enough to sign in, as it always was (it also holds the key that signs sign-ins), so keep it private.
- Names typed in full-width letters (as a Chinese or Japanese input method may) count as the same name in normal letters.
- Each browser keeps its own interface settings (theme, language, search sliders).
- The server keeps working when no browser is open; indexing continues in the background.
- Files and folders whose names aren't valid UTF-8 (possible on Linux) are skipped, by the folder picker and by indexing; the server log names the folder that holds them. Rename them to include them.
- On Linux, indexing skips hidden folders (names starting with a dot), `@eaDir` (Synology thumbnails) and `lost+found`, and folder names that differ only in case are different folders.
