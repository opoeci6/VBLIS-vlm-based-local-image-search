"""Whole-page errors for a browser that opens an address of the network listener by itself.

The gate refuses some requests before the interface loads (an unknown host name, a device outside the local
network, a proxy it doesn't trust), and the API answers its errors as JSON for the interface to read. A browser
that loaded such an address as a page (typed, bookmarked, or a picture or video opened in a tab of its own)
showed that text bare. It now gets a page in the sign-in screen's look instead: light or dark like the device,
in English or Simplified Chinese by the browser's language. The interface's own requests still get JSON.

The page runs no script. Its one style block is allowed by its hash, and every value in it is escaped."""
import base64
import hashlib
import html
import json
from http import HTTPStatus

from starlette.responses import HTMLResponse

ENGLISH = "en"
CHINESE = "zh-CN"

_STYLE = (
    ':root{color-scheme:light dark;--bg:#fff;--card:#fff;--border:#e5e7eb;--text:#171717;--muted:#737373;'
    '--faint:#a3a3a3;--brand:#4f46e5;--tile:#eef2ff;--ring:#c7d2fe;--button:#4f46e5;--button-hover:#6366f1;'
    '--warn:#f59e0b;--shadow:rgba(0,0,0,.05);--code:#f5f5f5}'
    '@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--card:rgba(23,23,23,.7);--border:#262626;--text:#fff;'
    '--muted:#a3a3a3;--faint:#737373;--brand:#818cf8;--tile:rgba(99,102,241,.1);--ring:rgba(99,102,241,.2);'
    '--shadow:rgba(0,0,0,.2);--code:#262626}}'
    '*{box-sizing:border-box}'
    'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}'
    'body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;'
    'padding:max(40px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) '
    'max(40px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:var(--bg);'
    'color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",'
    'Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif}'
    'main{width:100%;max-width:24rem}'
    '.brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:32px}'
    '.tile{width:40px;height:40px;flex:none;display:flex;align-items:center;justify-content:center;'
    'border-radius:12px;background:var(--tile);color:var(--brand);box-shadow:inset 0 0 0 1px var(--ring)}'
    '.tile svg{width:20px;height:20px}'
    '.name{font-size:24px;line-height:32px;font-weight:700;color:var(--brand)}'
    '.card{background:var(--card);border:1px solid var(--border);border-radius:24px;'
    'box-shadow:0 20px 25px -5px var(--shadow),0 8px 10px -6px var(--shadow);padding:24px;text-align:center}'
    '.icon{display:block;width:32px;height:32px;margin:0 auto 16px;color:var(--warn)}'
    'h1{margin:0 0 8px;font-size:16px;line-height:24px;font-weight:700}'
    'p{margin:0;color:var(--muted);overflow-wrap:anywhere}'
    'p+p{margin-top:8px}'
    '.extra{font-size:12px}'
    'code{font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;font-size:.92em;padding:1px 4px;'
    'border-radius:4px;background:var(--code);color:var(--text)}'
    '.button{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:16px;'
    'padding:10px 16px;border-radius:12px;background:var(--button);color:#fff;font-weight:600;'
    'text-decoration:none}'
    '.button:hover{background:var(--button-hover)}'
    '.button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}'
    '.status{margin-top:16px;font-size:12px;color:var(--faint)}'
)
_STYLE_HASH = base64.b64encode(hashlib.sha256(_STYLE.encode("utf-8")).digest()).decode("ascii")
PAGE_CSP = (f"default-src 'none'; style-src 'sha256-{_STYLE_HASH}'; base-uri 'none'; form-action 'none'; "
            "frame-ancestors 'none'")

# The app's icons (lucide), drawn inline so the page loads nothing else
_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{extra}>{shapes}</svg>')
_LOGO = ('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/>'
         '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>')
_ICONS = {
    "alert": ('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>'
              '<path d="M12 9v4"/><path d="M12 17h.01"/>'),
    "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    "search": '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
}

# kind: (icon, link at the bottom: "home", "sign_in" or None)
_KINDS = {
    "not_built": ("alert", None),
    "not_found": ("search", "home"),
    "method": ("alert", "home"),
    "untrusted_proxy": ("lock", None),
    "unknown_host": ("lock", None),
    "outside_network": ("lock", None),
    "needs_https": ("lock", None),
    "sign_in": ("lock", "sign_in"),
    "owner_only": ("lock", "home"),
    "not_permitted": ("lock", "home"),
    "not_on_network": ("lock", "home"),
    "bad_request": ("alert", "home"),
    "forbidden": ("lock", "home"),
    "gone": ("search", "home"),
    "too_large": ("alert", "home"),
    "too_many": ("alert", "home"),
    "server_error": ("alert", "home"),
    "error": ("alert", "home"),
}

# kind: (title, message, hint or None). {address} is filled in, escaped. The setting names in a hint stay
# English in both languages: they are what the owner types.
_TEXTS = {
    ENGLISH: {
        "not_built": ("The web interface isn't installed",
                      "The VBLIS server is running, but it has no web interface to show.",
                      "SERVER.md explains how to build it or install it from a release."),
        "not_found": ("Not found", "There's nothing at this address.", None),
        "method": ("Not allowed", "This address can't be used this way.", None),
        "untrusted_proxy": ("Request refused", "This request came through a proxy that VBLIS doesn't trust.",
                            "The owner can add the proxy's address to trusted_proxies in the server settings."),
        "unknown_host": ("Unknown server name", "This server doesn't answer to the name in this address.",
                         "Open VBLIS with the server's IP address, or ask the owner to add this name to "
                         "allowed_hosts."),
        "outside_network": ("Not available from this network",
                            "Access from outside the local network is turned off. "
                            "This server sees your device as {address}.",
                            "If the device is on the owner's network, the owner can add this address to the "
                            "other local networks in the server settings."),
        "needs_https": ("HTTPS needed", "Access from the internet needs HTTPS.",
                        "Open this address with https:// instead."),
        "sign_in": ("Sign in first", "Sign in to VBLIS, then open this again.", None),
        "owner_only": ("Only the owner can do this", "This needs an owner account.", None),
        "not_permitted": ("Not allowed", "The owner hasn't allowed this for your account.", None),
        "not_on_network": ("Not available over the network",
                           "This works only in the VBLIS app on the server's computer.", None),
        "bad_request": ("Request not valid", "The address is missing something or has a wrong value.", None),
        "forbidden": ("Not allowed", "This isn't allowed.", None),
        "gone": ("No longer available", "Go back to VBLIS and try again.", None),
        "too_large": ("Too large", "The server can't take a request this large.", None),
        "too_many": ("Too many requests", "Wait a moment, then try again.", None),
        "server_error": ("Something went wrong",
                         "The server couldn't finish this request. Try again in a moment.", None),
        "error": ("Something went wrong", "The server couldn't answer this request.", None),
    },
    CHINESE: {
        "not_built": ("未安装网页界面", "VBLIS 服务器正在运行，但没有可显示的网页界面。",
                      "构建网页界面或从发布版本安装的方法见 SERVER.md。"),
        "not_found": ("未找到", "此地址没有内容。", None),
        "method": ("不允许此操作", "无法以这种方式使用此地址。", None),
        "untrusted_proxy": ("请求被拒绝", "此请求经过了 VBLIS 不信任的代理。",
                            "所有者可以在服务器设置的 trusted_proxies 中添加该代理的地址。"),
        "unknown_host": ("未知的服务器名称", "此服务器不接受该地址中的名称。",
                         "请使用服务器的 IP 地址打开 VBLIS，或请所有者将此名称添加到 allowed_hosts。"),
        "outside_network": ("无法从此网络访问",
                            "已关闭来自本地网络以外的访问。服务器识别到的设备地址为 {address}。",
                            "如果此设备位于所有者的网络中，所有者可以在服务器设置中将该地址添加到“其他本地网络”。"),
        "needs_https": ("需要 HTTPS", "从互联网访问需要使用 HTTPS。", "请改用 https:// 打开此地址。"),
        "sign_in": ("请先登录", "登录 VBLIS 后，再重新打开此地址。", None),
        "owner_only": ("仅限所有者", "此操作需要所有者账户。", None),
        "not_permitted": ("未获允许", "所有者未允许此账户执行此操作。", None),
        "not_on_network": ("无法通过网络使用", "此功能只能在服务器所在电脑上的 VBLIS 应用中使用。", None),
        "bad_request": ("请求无效", "地址缺少内容或包含错误的值。", None),
        "forbidden": ("不允许访问", "不允许执行此操作。", None),
        "gone": ("已不可用", "请返回 VBLIS 后重试。", None),
        "too_large": ("请求过大", "服务器无法处理这么大的请求。", None),
        "too_many": ("请求过多", "请稍候再试。", None),
        "server_error": ("出现问题", "服务器无法完成此请求，请稍后重试。", None),
        "error": ("出现问题", "服务器无法处理此请求。", None),
    },
}

_WORDS = {
    ENGLISH: {"home": "Open VBLIS", "sign_in": "Sign in", "unknown_address": "an unknown address",
              "error_id": "Error ID", "server_says": "The server says: {detail}"},
    CHINESE: {"home": "打开 VBLIS", "sign_in": "登录", "unknown_address": "未知地址",
              "error_id": "错误编号", "server_says": "服务器信息：{detail}"},
}

_CODE_WORDS = ("trusted_proxies", "allowed_hosts", "SERVER.md", "https://")


def wants_page(headers) -> bool:
    """True when the browser is loading this address as a page of its own (typed, a link, a bookmark, a new
    tab), not the interface calling the API, nor an <img> or <video> loading it."""
    mode = (headers.get("sec-fetch-mode") or "").strip().lower()
    if mode:
        return mode == "navigate"
    # Browsers from before Fetch Metadata: only a page load asks for HTML
    return "text/html" in (headers.get("accept") or "").lower()


def language(accept_language) -> str:
    """Simplified Chinese when the browser's first language is Chinese, else English. This is what the
    interface's "Follow system" picks."""
    best, best_q = None, 0.0
    for part in (accept_language or "").split(","):
        tag, _, params = part.partition(";")
        tag = tag.strip().lower()
        if not tag:
            continue
        q = 1.0
        for param in params.split(";"):
            key, _, number = param.partition("=")
            if key.strip().lower() == "q":
                try:
                    q = float(number)
                except ValueError:
                    q = 0.0
        if q > best_q:  # the first of equals wins; q=0 means "not this one"
            best, best_q = tag, q
    return CHINESE if best is not None and (best == "zh" or best.startswith("zh-")) else ENGLISH


def kind_for_status(status: int) -> str:
    if status == 401:
        return "sign_in"
    if status in (400, 422):
        return "bad_request"
    return {403: "forbidden", 404: "not_found", 405: "method", 410: "gone", 413: "too_large",
            429: "too_many"}.get(status, "server_error" if status >= 500 else "error")


def _text(value: str) -> str:
    return html.escape(value, quote=False)


def _ours(value: str, address=None, lang=ENGLISH) -> str:
    """One of this module's own texts, escaped, with its setting names as code and {address} filled in."""
    out = _text(value)
    for word in _CODE_WORDS:
        out = out.replace(word, f"<code>{word}</code>")
    if "{address}" in out:
        shown = f"<code>{_text(address)}</code>" if address else _text(_WORDS[lang]["unknown_address"])
        out = out.replace("{address}", shown)
    return out


def render(kind: str, status: int, lang: str = ENGLISH, address=None, detail=None, error_id=None) -> str:
    """The page for one error. `detail` is the server's own English text (shown as the message in English, as
    a second line in Chinese); `error_id` matches the server log's line for a failure."""
    lang = lang if lang in _TEXTS else ENGLISH
    kind = kind if kind in _KINDS else "error"
    icon, link = _KINDS[kind]
    title, message, hint = _TEXTS[lang][kind]
    words = _WORDS[lang]

    paragraphs = []
    if detail and lang == ENGLISH:
        paragraphs.append(f"<p>{_text(detail)}</p>")
    else:
        paragraphs.append(f"<p>{_ours(message, address, lang)}</p>")
        if detail:
            paragraphs.append(f'<p class="extra">{_text(words["server_says"].format(detail=detail))}</p>')
    if hint:
        paragraphs.append(f"<p>{_ours(hint, address, lang)}</p>")
    button = f'<a class="button" href="/">{_text(words[link])}</a>' if link else ""
    footer = ""
    if status >= 400:
        footer = f"HTTP {int(status)}"
        if error_id:
            footer += f" · {_text(words['error_id'])} {_text(str(error_id))}"
        footer = f'<p class="status">{footer}</p>'
    logo = _SVG.format(extra="", shapes=_LOGO)
    symbol = _SVG.format(extra=' class="icon"', shapes=_ICONS[icon])
    return (
        f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        '<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex">'
        f"<title>{_text(title)} · VBLIS</title><style>{_STYLE}</style></head><body><main>"
        f'<div class="brand"><div class="tile">{logo}</div><span class="name">VBLIS</span></div>'
        f'<div class="card">{symbol}<h1>{_text(title)}</h1>{"".join(paragraphs)}{button}{footer}</div>'
        "</main></body></html>"
    )


def page_response(kind, status, accept_language=None, address=None, detail=None, error_id=None,
                  headers=None) -> HTMLResponse:
    response_headers = dict(headers or {})
    response_headers["content-security-policy"] = PAGE_CSP
    response_headers["cache-control"] = "no-store"
    page = render(kind, status, language(accept_language), address=address, detail=detail, error_id=error_id)
    return HTMLResponse(page, status_code=status, headers=response_headers)


def _from_json(status: int, body: bytes):
    """(detail worth showing or None, error id or None) from an API error answer."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None, None
    if not isinstance(data, dict):
        return None, None
    error_id = data.get("error_id") if isinstance(data.get("error_id"), str) else None
    detail = data.get("detail")
    if status == 401 or status >= 500 or not isinstance(detail, str):
        return None, error_id
    detail = detail.strip()
    try:
        phrase = HTTPStatus(status).phrase
    except ValueError:
        phrase = ""
    if not detail or len(detail) > 500 or detail.lower() == phrase.lower():
        return None, error_id
    return detail, error_id


_REPLACED = frozenset({b"content-type", b"content-length", b"content-security-policy", b"cache-control"})


def html_errors(send, accept_language=None):
    """Wraps an ASGI send for a page load under /api: a JSON error answer (4xx or 5xx) becomes the page, with its
    status and its other headers (Retry-After, Set-Cookie). Everything else passes through unchanged."""
    held = None  # [start message, body parts] of a JSON error being collected

    async def wrapped(message):
        nonlocal held
        if message["type"] == "http.response.start":
            content_type = b""
            for key, value in message.get("headers") or ():
                if key.lower() == b"content-type":
                    content_type = value.split(b";")[0].strip().lower()
            if message["status"] >= 400 and content_type == b"application/json":
                held = [message, []]
                return
            await send(message)
            return
        if held is not None and message["type"] == "http.response.body":
            held[1].append(message.get("body", b""))
            if message.get("more_body", False):
                return
            start, parts = held
            held = None
            status = start["status"]
            detail, error_id = _from_json(status, b"".join(parts))
            body = render(kind_for_status(status), status, language(accept_language), detail=detail,
                          error_id=error_id).encode("utf-8")
            headers = [(k, v) for k, v in start.get("headers") or () if k.lower() not in _REPLACED]
            headers += [
                (b"content-type", b"text/html; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"content-security-policy", PAGE_CSP.encode("ascii")),
                (b"cache-control", b"no-store"),
            ]
            await send({"type": "http.response.start", "status": status, "headers": headers})
            await send({"type": "http.response.body", "body": body})
            return
        await send(message)

    return wrapped
