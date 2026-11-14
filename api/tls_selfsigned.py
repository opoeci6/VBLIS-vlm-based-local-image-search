"""A self-signed HTTPS certificate for the network listener.

The certificate is kept on disk and reused on every start, because a browser or phone that accepted it
once (or a user who compared its fingerprint) must not be asked again at every restart. A new pair is
made only when the old one can't be used any more:
- a file is missing, unreadable, or the key doesn't belong to the certificate (also what a crash
  between writing the two files leaves behind);
- it is expired, not valid yet, or expires within RENEW_BEFORE_DAYS;
- it doesn't list a name or address this machine is reached by now (a new network, a renamed computer).

A renewed certificate keeps the names and addresses of the one it replaces, so a laptop that moves
between networks keeps working on the old addresses too, up to MAX_SAN_ENTRIES in total."""
import datetime
import ipaddress
import os
import pathlib
import re
import secrets

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CERT_NAME = "cert.pem"
KEY_NAME = "key.pem"
RENEW_BEFORE_DAYS = 30
VALID_DAYS = 397
MAX_SAN_ENTRIES = 64

_DNS_NAME = re.compile(r"^[a-z0-9_]([a-z0-9_.-]*[a-z0-9_])?$")


def _now() -> datetime.datetime:
    """The current time, aware and in UTC. Tests patch this."""
    return datetime.datetime.now(datetime.timezone.utc)


def _clean_name(value) -> str:
    """A DNS name as stored in the certificate (lower case), or "" when it isn't one."""
    name = str(value).strip().lower().rstrip(".")
    if not name or len(name) > 253 or not _DNS_NAME.match(name):
        return ""
    return name


def _clean_address(value):
    """An ipaddress object, or None when the text isn't an IP address."""
    try:
        return ipaddress.ip_address(str(value).strip())
    except ValueError:
        return None


def _names_in(cert) -> tuple:
    """(DNS names, IP addresses) in the certificate's SubjectAlternativeName, each in file order."""
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound:
        return [], []
    return list(san.get_values_for_type(x509.DNSName)), list(san.get_values_for_type(x509.IPAddress))


def _read_pair(directory: pathlib.Path):
    """(certificate, key) when both files load, else None."""
    try:
        cert = x509.load_pem_x509_certificate((directory / CERT_NAME).read_bytes())
        key = serialization.load_pem_private_key((directory / KEY_NAME).read_bytes(), password=None)
    except (OSError, ValueError, TypeError):
        return None
    return cert, key


def _read_cert(directory: pathlib.Path):
    """The certificate alone, to carry its names over when the key is the broken part."""
    try:
        return x509.load_pem_x509_certificate((directory / CERT_NAME).read_bytes())
    except (OSError, ValueError):
        return None


def _public_bytes(public_key) -> bytes:
    return public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


def _is_usable(cert, key, names: list, addresses: list, now) -> bool:
    if _public_bytes(cert.public_key()) != _public_bytes(key.public_key()):
        return False
    if cert.not_valid_before_utc > now:
        return False
    if cert.not_valid_after_utc - now < datetime.timedelta(days=RENEW_BEFORE_DAYS):
        return False
    have_names, have_addresses = _names_in(cert)
    have_names = {n.lower() for n in have_names}
    have_addresses = set(have_addresses)
    return all(n in have_names for n in names) and all(a in have_addresses for a in addresses)


def _write_atomic(path: pathlib.Path, data: bytes, mode: int) -> None:
    """Write through a temp file in the same folder, so the target is never half written.
    The temp file is created with `mode` from the start: a private key is never world readable."""
    temp = path.with_name(f"{path.name}.{secrets.token_hex(4)}.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), mode)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def _build_certificate(key, names: list, addresses: list, now):
    host = names[0] if names else "this computer"
    common_name = f"VBLIS on {host}"[:64]
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "VBLIS (self-signed)"),
    ])
    san = [x509.DNSName(n) for n in names] + [x509.IPAddress(a) for a in addresses]
    return (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=VALID_DAYS))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )


def ensure_certificate(directory, host_names, ip_addresses) -> tuple:
    """(certificate file, key file) in `directory`, creating or renewing the pair when needed.
    Entries that aren't valid names or addresses are skipped."""
    directory = pathlib.Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)

    names = []
    for value in host_names:
        name = _clean_name(value)
        if name and name not in names:
            names.append(name)
    addresses = []
    for value in ip_addresses:
        address = _clean_address(value)
        if address is not None and address not in addresses:
            addresses.append(address)

    now = _now()
    pair = _read_pair(directory)
    if pair is not None and _is_usable(pair[0], pair[1], names, addresses, now):
        return directory / CERT_NAME, directory / KEY_NAME

    # The old certificate's entries come after the requested ones, so the cap drops those first
    wanted = [("dns", n) for n in names] + [("ip", a) for a in addresses]
    old = pair[0] if pair is not None else _read_cert(directory)
    if old is not None:
        old_names, old_addresses = _names_in(old)
        for value in old_names:
            name = _clean_name(value)
            if name and ("dns", name) not in wanted:
                wanted.append(("dns", name))
        for address in old_addresses:
            if ("ip", address) not in wanted:
                wanted.append(("ip", address))
    wanted = wanted[:MAX_SAN_ENTRIES] or [("dns", "localhost")]
    names = [v for kind, v in wanted if kind == "dns"]
    addresses = [v for kind, v in wanted if kind == "ip"]

    key = ec.generate_private_key(ec.SECP256R1())
    certificate = _build_certificate(key, names, addresses, now)
    key_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    # The key first: a crash between the two files leaves a pair that doesn't match, which is
    # regenerated next time
    _write_atomic(directory / KEY_NAME, key_pem, 0o600)
    _write_atomic(directory / CERT_NAME, certificate.public_bytes(serialization.Encoding.PEM), 0o644)
    return directory / CERT_NAME, directory / KEY_NAME
