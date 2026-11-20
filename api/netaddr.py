"""Address checks for the network listener: which clients count as local, which Host headers are
accepted, and how a forwarded client address is read. No framework imports, so the tables are
easy to test."""
import ipaddress

# ipaddress.is_private / is_global are not used: their answers changed between Python patch
# releases (100.64.0.0/10 and 192.0.0.0/24 among others), and a wrong "private" opens the server.
_PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(net)
    for net in (
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",  # link-local
        "100.64.0.0/10",  # carrier-grade NAT; Tailscale addresses live here
        "::1/128",
        "fc00::/7",  # unique local
        "fe80::/10",  # link-local
    )
)
_LOOPBACK_NETWORKS = (ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("::1/128"))

# Headers a proxy adds. One of them from a peer that is not a trusted proxy means the server
# sits behind something it wasn't told about, so the client address can't be trusted.
FORWARDED_HEADERS = (
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "cf-connecting-ip",
)

_HOST_NAME_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789.-_")
_MAX_HOST_HEADER = 300


def parse_ip(text):
    """The address in text, or None. Accepts [v6] brackets and a %zone suffix, and turns an
    IPv4-mapped IPv6 address (::ffff:192.168.1.5) into the IPv4 address it carries."""
    if not isinstance(text, str):
        return None
    value = text.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    value = value.split("%", 1)[0]
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    mapped = getattr(address, "ipv4_mapped", None)
    return mapped if mapped is not None else address


def _in_any(address, networks) -> bool:
    return any(address.version == net.version and address in net for net in networks)


def is_private_client(host) -> bool:
    """True for loopback, home and office networks, link-local and the CGNAT range. Anything that
    can't be parsed, a missing address included, counts as public."""
    address = parse_ip(host)
    return address is not None and _in_any(address, _PRIVATE_NETWORKS)


def is_loopback_client(host) -> bool:
    address = parse_ip(host)
    return address is not None and _in_any(address, _LOOPBACK_NETWORKS)


def parse_networks(entries) -> tuple:
    """Networks for a list of addresses or CIDR ranges. Raises ValueError naming the bad entry."""
    networks = []
    for entry in entries:
        try:
            networks.append(ipaddress.ip_network(str(entry).strip(), strict=False))
        except ValueError:
            raise ValueError(f"not an address or network: {entry!r}") from None
    return tuple(networks)


# "Other local networks" are for a network that shows a device to the server with an address outside the
# private ranges (a phone on a building's Wi-Fi seen as a public address). A wider range than these is a
# slice of the internet, which is what public access (HTTPS only) is for.
MIN_LOCAL_PREFIX = {4: 8, 6: 32}
_IPV4_MAPPED = ipaddress.ip_network("::ffff:0:0/96")


def _unmapped(network):
    """An IPv4-mapped IPv6 range (::ffff:203.0.113.9, as a server listening on :: shows an IPv4 client) as
    the IPv4 range it carries: clients are compared in their IPv4 form (parse_ip)."""
    if network.version == 6 and network.prefixlen >= 96 and network.subnet_of(_IPV4_MAPPED):
        return ipaddress.IPv4Network((int(network.network_address) & 0xFFFFFFFF, network.prefixlen - 96))
    return network


def parse_local_networks(entries) -> tuple:
    """Networks for the extra local networks. Raises ValueError naming an entry that isn't an address or a
    range, or a range wider than /8 (IPv4) or /32 (IPv6)."""
    networks = tuple(_unmapped(network) for network in parse_networks(entries))
    for entry, network in zip(entries, networks):
        if network.prefixlen < MIN_LOCAL_PREFIX[network.version]:
            raise ValueError(f"{str(entry).strip()!r} is too wide (at most /{MIN_LOCAL_PREFIX[network.version]}); "
                             "for clients from anywhere, turn on public access with HTTPS")
    return networks


def in_networks(host, networks) -> bool:
    address = parse_ip(host)
    return address is not None and _in_any(address, networks)


def forwarded_client(header_value, trusted_networks):
    """The client address from an X-Forwarded-For value sent by a trusted proxy: the last entry
    that is not itself a trusted proxy. None when the value is empty or holds anything that is
    not an address, so the caller treats the client as public."""
    if not isinstance(header_value, str):
        return None
    entries = [entry.strip() for entry in header_value.split(",")]
    if not entries or any(parse_ip(entry) is None for entry in entries):
        return None
    for entry in reversed(entries):
        if not in_networks(entry, trusted_networks):
            return str(parse_ip(entry))
    return str(parse_ip(entries[0]))


def split_host(header):
    """(name, port) from a Host header, or None when it is malformed. The name is lower-cased
    without a trailing dot; an IPv6 address comes back without its brackets; port is an int or None."""
    if not isinstance(header, str) or not header or len(header) > _MAX_HOST_HEADER:
        return None
    value = header.strip()
    if value.startswith("["):
        end = value.find("]")
        if end == -1:
            return None
        name, rest = value[1:end], value[end + 1:]
        address = parse_ip(name)
        if address is None or address.version != 6 and ":" not in name:
            return None
        name = name.lower()
        if rest == "":
            port_text = None
        elif rest.startswith(":"):
            port_text = rest[1:]
        else:
            return None
    else:
        if value.count(":") > 1:
            return None
        name, _, port_text = value.partition(":")
        if ":" not in value:
            port_text = None
        name = name.lower().rstrip(".")
        if not name or not set(name) <= _HOST_NAME_CHARS:
            return None
    if port_text is None:
        return name, None
    if not port_text.isascii() or not port_text.isdigit() or len(port_text) > 5:
        return None
    port = int(port_text)
    if not 0 < port <= 65535:
        return None
    return name, port


def default_host_names(hostname) -> frozenset:
    """Names a browser on the local network uses for this machine."""
    names = {"localhost"}
    if isinstance(hostname, str):
        short = hostname.strip().lower().rstrip(".")
        if short and set(short) <= _HOST_NAME_CHARS:
            names.add(short)
            if "." not in short:
                names.add(short + ".local")
    return frozenset(names)


def host_allowed(header, allowed_names) -> bool:
    """True when the Host header names this server by address or by an allowed name. An address
    is always fine: DNS rebinding needs a name the attacker controls."""
    parsed = split_host(header)
    if parsed is None:
        return False
    name = parsed[0]
    if parse_ip(name) is not None:
        return True
    return name in allowed_names


def normalize_host_names(entries) -> tuple:
    """Lower-cased host names from a config list. Raises ValueError naming the bad entry."""
    names = []
    for entry in entries:
        name = str(entry).strip().lower().rstrip(".")
        if not name or not set(name) <= _HOST_NAME_CHARS:
            raise ValueError(f"not a host name: {entry!r}")
        if name not in names:
            names.append(name)
    return tuple(names)
