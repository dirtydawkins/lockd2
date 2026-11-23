# OVERCLOCK Connect pilot client

Run `build.ps1` in PowerShell on 64-bit Windows. The script uses the installed .NET Framework compiler and creates an unsigned lab executable. Pass `-OutputDirectory` to choose the build location.

Open LOCKD launches the public pilot page in the default browser. Website diagnostics make a bounded HTTPS request to that page. They measure website reachability only. The desktop app stores no account credentials. Remote desktop, native account handoff and stream diagnostics require the host and transport integration.

Run `python3 infra/overclock/host_readiness.py` as the intended operator on a candidate Linux host. It reports local KVM access, tools and GPU placement in IOMMU groups without changing system settings. A passing report starts hardware evaluation. Verify group isolation, driver assignment, reset, guest rendering and encoding on the machine before renting it.
