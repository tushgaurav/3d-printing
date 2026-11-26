# coding=utf-8
"""Raspberry Pi health for the quick-info panel and the network page: CPU temperature,
power/throttling, network (with the Wi-Fi name), memory, disk and uptime.

Everything is read from /proc and /sys (no extra packages), except the Wi-Fi name,
which comes from `iw` (or `iwgetid`) when installed. Each reading is independent
and comes back as None when it isn't available, e.g. on a machine that isn't a
Pi, so one missing file never hides the rest.
"""
from __future__ import absolute_import, unicode_literals

import io
import os
import shutil
import socket
import subprocess
import time

THROTTLE_SYSFS = "/sys/devices/platform/soc/soc:firmware/get_throttled"


def _read(path):
    try:
        with io.open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except (IOError, OSError):
        return None


def cpu_temp():
    """SoC temperature in degrees C."""
    text = _read("/sys/class/thermal/thermal_zone0/temp")
    try:
        return round(int(text.strip()) / 1000.0, 1)
    except (AttributeError, ValueError):
        return None


_vcgencmd_missing = False


def throttled():
    """The firmware's throttle bit field (see `vcgencmd get_throttled`), or None.

    Newer kernels expose it in sysfs, which costs nothing to read; otherwise ask
    vcgencmd, and stop asking once it turns out not to exist.
    """
    global _vcgencmd_missing
    text = _read(THROTTLE_SYSFS)
    if text is not None:
        try:
            return int(text.strip(), 16)
        except ValueError:
            pass
    if _vcgencmd_missing:
        return None
    try:
        out = subprocess.check_output(["vcgencmd", "get_throttled"], stderr=subprocess.STDOUT, timeout=2)
    except (OSError, subprocess.SubprocessError):
        _vcgencmd_missing = True
        return None
    return parse_throttled(out.decode("ascii", "replace"))


def parse_throttled(text):
    """'throttled=0x50005' -> 327685"""
    try:
        return int(text.strip().split("=", 1)[1], 16)
    except (IndexError, ValueError):
        return None


def parse_default_iface(route_text):
    """Interface of the default route, from the text of /proc/net/route."""
    for line in (route_text or "").splitlines()[1:]:
        cols = line.split()
        if len(cols) > 2 and cols[1] == "00000000":
            return cols[0]
    return None


def parse_wifi_signal(wireless_text, iface):
    """Signal level in dBm for iface, from the text of /proc/net/wireless."""
    for line in (wireless_text or "").splitlines()[2:]:
        name, _, rest = line.partition(":")
        if name.strip() != iface:
            continue
        cols = rest.split()
        try:
            level = float(cols[2].rstrip("."))
        except (IndexError, ValueError):
            return None
        # some drivers report 0..255 instead of signed dBm
        return int(level - 256 if level > 63 else level)
    return None


def local_ip():
    """The address other devices on the LAN reach this machine at."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # connect() on UDP only picks a route; nothing is sent
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except (OSError, socket.error):
        return None
    finally:
        s.close()


def parse_iw_link(text):
    """(ssid, freq MHz) from the text of `iw dev <iface> link`; Nones when not connected."""
    ssid = freq = None
    for line in (text or "").splitlines():
        key, _, value = line.strip().partition(": ")
        if key == "SSID":
            ssid = value or None
        elif key == "freq":
            try:
                freq = int(float(value.split()[0]))
            except (IndexError, ValueError):
                pass
    return ssid, freq


# iw and iwgetid live in /usr/sbin, which a non-root PATH often leaves out
_TOOL_PATH = os.pathsep.join(p for p in (os.environ.get("PATH"), "/usr/sbin", "/sbin") if p)
_SSID_TTL = 30  # seconds; the quick-info panel polls every few, the network rarely changes
_ssid_cache = {}


def _run(args):
    exe = shutil.which(args[0], path=_TOOL_PATH)
    if not exe:
        return None
    try:
        out = subprocess.check_output([exe] + args[1:], stderr=subprocess.DEVNULL, timeout=2)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.decode("utf-8", "replace")


def wifi_link(iface):
    """{'ssid': name, 'freq': MHz} of the Wi-Fi network iface is on, or Nones."""
    cached = _ssid_cache.get(iface)
    if cached and time.time() - cached[0] < _SSID_TTL:
        return cached[1]
    ssid, freq = parse_iw_link(_run(["iw", "dev", iface, "link"]))
    if ssid is None:
        ssid = (_run(["iwgetid", iface, "--raw"]) or "").strip() or None
    result = {"ssid": ssid, "freq": freq}
    _ssid_cache[iface] = (time.time(), result)
    return result


SYS_NET = "/sys/class/net"
SIOCGIFADDR = 0x8915  # Linux ioctl: an interface's IPv4 address


def _attr(iface, name):
    text = _read("%s/%s/%s" % (SYS_NET, iface, name))
    return text.strip() if text is not None else None


def _plugged(iface):
    # reading carrier fails while the interface is down, which _read turns into None
    return _attr(iface, "carrier") == "1"


def _is_wireless(iface, wireless_text):
    return os.path.isdir("%s/%s/wireless" % (SYS_NET, iface)) or iface + ":" in (wireless_text or "")


def interfaces(wireless_text):
    """(Wi-Fi names, Ethernet names) of the physical network interfaces, sorted."""
    try:
        names = sorted(os.listdir(SYS_NET))
    except OSError:
        return [], []
    wifi, wired = [], []
    for name in names:
        if not os.path.exists("%s/%s/device" % (SYS_NET, name)):
            continue  # loopback, bridges, VPNs, docker: no hardware behind them
        if _is_wireless(name, wireless_text):
            wifi.append(name)
        elif _attr(name, "type") == "1":  # ARPHRD_ETHER
            wired.append(name)
    return wifi, wired


def iface_ip(iface):
    """IPv4 address of one interface, or None."""
    try:
        import fcntl
        import struct
    except ImportError:
        return None
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        packed = fcntl.ioctl(s.fileno(), SIOCGIFADDR, struct.pack("256s", iface[:15].encode("utf-8")))
        return socket.inet_ntoa(packed[20:24])
    except (IOError, OSError):
        return None
    finally:
        s.close()


def ethernet(names):
    """The wired port, preferring one with a cable in: {'iface', 'connected', 'ip', 'speed' (Mb/s)},
    or None when the machine has no Ethernet port."""
    if not names:
        return None
    up = [n for n in names if _plugged(n)]
    iface = (up or names)[0]
    if not up:
        return {"iface": iface, "connected": False, "ip": None, "speed": None}
    try:
        speed = int(_attr(iface, "speed"))
    except (TypeError, ValueError):
        speed = None
    return {"iface": iface, "connected": True, "ip": iface_ip(iface), "speed": speed if speed and speed > 0 else None}


def network():
    """The connection in use (the default route's interface: 'iface', 'ip', 'wifi'), the Wi-Fi
    link even when Ethernet carries the traffic ('ssid', 'signal', 'freq'), and the wired port."""
    iface = parse_default_iface(_read("/proc/net/route"))
    wireless = _read("/proc/net/wireless")
    is_wifi = bool(iface) and _is_wireless(iface, wireless)
    wifi_names, wired_names = interfaces(wireless)
    wlan = iface if is_wifi else next((n for n in wifi_names if _plugged(n)), None)
    link = wifi_link(wlan) if wlan else {"ssid": None, "freq": None}
    return {
        "hostname": socket.gethostname() or None,
        "ip": local_ip(),
        "iface": iface,
        "wifi": is_wifi,
        "signal": parse_wifi_signal(wireless, wlan) if wlan else None,
        "ssid": link["ssid"],
        "freq": link["freq"],
        "ethernet": ethernet(wired_names),
    }


def parse_meminfo(text):
    """{'total': bytes, 'available': bytes} from the text of /proc/meminfo."""
    values = {}
    for line in (text or "").splitlines():
        key, _, rest = line.partition(":")
        if key in ("MemTotal", "MemAvailable"):
            try:
                values[key] = int(rest.split()[0]) * 1024
            except (IndexError, ValueError):
                pass
    if "MemTotal" not in values:
        return None
    return {"total": values["MemTotal"], "available": values.get("MemAvailable")}


def uptime():
    text = _read("/proc/uptime")
    try:
        return int(float(text.split()[0]))
    except (AttributeError, IndexError, ValueError):
        return None


def disk(path):
    try:
        usage = shutil.disk_usage(path)
    except (OSError, TypeError):
        return None
    return {"total": usage.total, "free": usage.free}


def load():
    try:
        return [round(v, 2) for v in os.getloadavg()]
    except (AttributeError, OSError):
        return None


def model():
    text = _read("/proc/device-tree/model")
    return text.strip("\x00 \n") if text else None


def collect(disk_path):
    return {
        "model": model(),
        "cpuTemp": cpu_temp(),
        "throttled": throttled(),
        "load": load(),
        "cores": os.cpu_count(),
        "mem": parse_meminfo(_read("/proc/meminfo")),
        "disk": disk(disk_path),
        "uptime": uptime(),
        "net": network(),
    }
