# Installing Research Canvas on macOS

macOS will refuse to open this app the first time and may say it is damaged or
contains malware. **It does not.** This page explains exactly what is
happening, because "just ignore the warning" is not something anyone should be
asked to do on trust.

## What is actually going on

Apple asks developers to pay for a Developer Program membership, sign their app
with a certificate tied to that membership, and upload every build to Apple to
be scanned — a process called *notarisation*. An app that has not been through
it, downloaded from the internet, is blocked by Gatekeeper.

Research Canvas has not been through it. The project has no funding and no
company behind it, and the membership costs money every year.

So the warning is accurate about one thing — Apple has not vouched for this
app — and wrong about the other: nothing has been scanned and found harmful.
Nothing has been scanned at all.

**What you can verify instead:** every line of this app is in this repository,
every release is built by a public GitHub Actions run you can read, and the
build that produced your download is linked from the release page. That is a
stronger guarantee than most notarised software offers, and it does not require
trusting us.

## Opening it

Drag `Research Canvas.app` to your Applications folder, then either:

**In Terminal** — removes the "downloaded from the internet" flag:

```sh
xattr -dr com.apple.quarantine "/Applications/Research Canvas.app"
```

**Or without the Terminal** — try to open the app, let it be blocked, then go to
**System Settings → Privacy & Security**, scroll down, and press **Open Anyway**
next to the message about Research Canvas.

Either way it is a one-off. The app opens normally from then on, and updates
installed by the app itself are not quarantined.

## Building it yourself instead

If you would rather not run a binary you did not build:

```sh
git clone https://github.com/saikiran9185/research-canvas-app.git
cd research-canvas-app
npm install
npm run app        # builds and installs into /Applications
```

Needs Node and Rust. A build you made locally is never quarantined.

## When this will stop being necessary

When the project can pay for an Apple Developer membership, releases will be
signed with a Developer ID and notarised, and this page becomes unnecessary.
Until then this is the honest situation rather than a bug to be worked around
quietly.
