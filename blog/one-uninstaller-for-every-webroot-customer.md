---
title: "One uninstaller for every Webroot customer: a reverse-engineering story"
published: false
tags: powershell, security, reverseengineering, sysadmin
cover_image: https://raw.githubusercontent.com/EkoSamaGHub/webroot-keycode-agnostic-uninstaller/main/site/poster.jpg
canonical_url: https://ekosamaghub.github.io/webroot-keycode-agnostic-uninstaller/
---

Two files landed in my inbox. Same name pattern, both about 4.67 MB, both Webroot uninstallers, one built per customer site. They looked almost identical. They were not. The story of *why* they differ turned into a small, useful open-source tool, and a lesson about the difference between removing software the right way and the wrong way.

If you run a fleet and you have ever fought Webroot SecureAnywhere on the way out, this one is for you.

## The setup: two near-identical signed binaries

Webroot ships a per-customer uninstaller. Each build is locked to that customer. So a managed-services shop with a hundred clients ends up with a drawer full of slightly different `WRUninstaller-*.EXE` files, and the wrong one does not help you on the wrong machine.

First instinct on any binary: do not run it, look at it. Hash it, check the signature, read the metadata.

```text
SHA256   131B1D69...A9BCA0   (file A)
SHA256   B63459EF...113C6E   (file B)
Authenticode   Valid - signature verified
Signer         Webroot Inc., Broomfield, Colorado, US
Issuer         Microsoft ID Verified CS CA
Product        Webroot SecureAnywhere, UltimateUninstall, v1.13.0.9
Publisher      Open Text  (OpenText owns Webroot, checks out)
```

Both genuinely signed by Webroot. Not tampered, not fake. Good. One small thing worth flagging, because it looks alarming until you understand it: the signing certificates were valid for only three days each. That is not a red flag. It is exactly how Microsoft's Azure Trusted Signing works. It issues ultra-short-lived certs and timestamps the signature so it stays valid after the cert expires. A forged signature would not chain cleanly back to Microsoft's CA the way these did.

So: two legitimate Webroot uninstallers. The sizes differed by 2,592 bytes. The question was where, and why.

## The difference is a key you cannot see

A naive diff is useless here, and that fact is the whole point. When I diffed the two files byte by byte, about **39 percent of the body was different**, scattered in tiny runs across the entire file. Not one clean block you could point at. Thousands of little differences everywhere.

That pattern has a specific cause. I measured the entropy of the body:

```text
Shannon entropy of the body: 8.00 bits/byte   (8.0 = fully compressed/encrypted)
```

Maxed out. The payload is packed. And packed data has a property that matters: change one byte of the *input* and the compressed *output* changes all over the place. So one tiny per-customer value, sealed inside that compressed blob, ripples across the whole file.

What is the per-customer value? A Webroot **keycode**. The license/identity for that customer.

I searched both files for the customer names and for the word "keycode," as ASCII and as UTF-16:

```text
"Coachcap"        0 hits
"Action Metal"    0 hits
"keycode"         0 hits
```

Zero plaintext. The only readable strings in the whole binary were `SecureAnywhere` and `OpenText` in the version resource. Everything customer-specific lives inside the compressed payload, unreadable without unpacking. That is why two builds of the same tool look 39 percent different: same program, different sealed keycode, then built and signed weeks apart so the timestamps and signature differ too.

So the honest one-line answer to "what is the difference between these two files" is: **the embedded customer keycode, and everything downstream of it being compressed.**

## The lock is a feature, not a bug

Here is where it gets interesting for anyone tempted to take a shortcut.

Webroot runs with tamper protection (self-protection). The uninstaller is keycode-gated on purpose. That is not Webroot being annoying. It is the control that stops malware from quietly switching off the antivirus. "Silently remove the endpoint protection" is precisely the move an attacker wants. So the keycode is the uninstaller's authorization token, and gating removal behind it is correct security design.

Which means "uninstall Webroot for any customer" splits into a right way and a wrong way, and the difference is not cosmetic.

**The wrong way:** patch the signed binary to skip the keycode and the tamper check. Now you have a tool that rips antivirus off a machine with no authorization. You have built the attacker's tool. Hard pass.

**The right way:** notice that every managed machine already has its *own* keycode sitting in its *own* local config. You do not need to crack anything. You need to read the key that is already there and hand it to Webroot's official uninstaller.

That second path is the whole tool.

## What I built

A single PowerShell script, `Remove-Webroot.ps1`, that runs on the target machine and:

1. **Detects** the agent (registry keys, services, `WRSA.exe`).
2. **Discovers** that machine's own keycode from its local config.
3. **Uninstalls** by handing that keycode to Webroot's official `WRSA.exe`.
4. **Sweeps** residual services, folders, registry keys, and scheduled tasks.

No hardcoded keycode. No per-customer build. One script, any customer.

The discovery step is the part that makes it generic. Rather than depend on one registry value name (which drifts across agent versions), it scans the Webroot hives for a value shaped like a keycode:

```powershell
# scan local config for a value shaped like a keycode
foreach ($root in $WebrootHives) {
  foreach ($value in (Get-Values $root)) {
    if ($value -match '^\w{4}(-\w{4}){4}$') {
      return $value   # this machine's own key
    }
  }
}
```

It is RMM-friendly: non-interactive, with exit codes that drop cleanly into NinjaOne, Datto RMM, ConnectWise Automate, Action1, Atera, Intune, SCCM, or a GPO startup script.

```text
0 = removed, or already absent
2 = installed but keycode not discoverable  (pass -KeyCode)
3 = uninstall ran but agent still present   (confirm the switch)
4 = not elevated
```

There is also a `-DiscoverOnly` dry run that detects the agent and prints the keycode source without removing anything, so you can validate on one box before you touch the fleet.

## The honest caveats

I am not going to pretend this is validated across every Webroot build in the wild. Two things should be confirmed on a live agent before a fleet rollout, and the script is built to confirm them for you:

1. **The exact registry value that holds the keycode.** `-DiscoverOnly` prints where it found it. If it comes up empty on your build, the README shows the two-line `reg query` to locate it.
2. **The current uninstall switch.** Webroot has changed this across versions, so the script tries a prioritized list and stops at whichever makes the agent disappear. Once you confirm the winner, pin it with `-UninstallArgs`.

If a customer set a *custom* uninstall password (separate from the keycode) in their console, that machine needs that password. The keycode alone will not override it, by design. Honoring that control is the point.

## Get it

- Repo (MIT): https://github.com/EkoSamaGHub/webroot-keycode-agnostic-uninstaller
- Live one-page briefing: https://ekosamaghub.github.io/webroot-keycode-agnostic-uninstaller/

If it saves you a bad afternoon, a star helps other people find it. Issues and PRs welcome, especially keycode-location and uninstall-switch confirmations from agent versions you run in production.

Built by [sotoprojdev.com](https://sotoprojdev.com).
