"""Read-only Linux readiness report for the first LOCKD GPU host."""
import json
import os
from pathlib import Path
import platform
import shutil
import sys


def report():
    linux = platform.system() == "Linux"
    groups = sorted(Path("/sys/kernel/iommu_groups").glob("*/devices/*")) if linux else []
    graphics = []
    for device in groups:
        try:
            device_class = (device / "class").read_text().strip()
        except OSError:
            continue
        if device_class.startswith(("0x03", "0x12")):
            graphics.append({"pci_address": device.name, "iommu_group": device.parent.parent.name})
    kvm = linux and Path("/dev/kvm").exists() and os.access("/dev/kvm", os.R_OK | os.W_OK)
    virsh = linux and shutil.which("virsh") is not None
    qemu = linux and any(shutil.which(name) for name in ("qemu-system-x86_64", "qemu-kvm"))
    return {
        "linux": linux,
        "kvm_accessible": kvm,
        "virsh_installed": virsh,
        "qemu_installed": qemu,
        "graphics_in_iommu_groups": graphics,
        "preflight_passed": bool(kvm and virsh and qemu and graphics),
    }


if __name__ == "__main__":
    result = report()
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["preflight_passed"] else 1)
