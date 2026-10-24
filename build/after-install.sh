#!/bin/bash
# Custom deb postinst — based on electron-builder's stock after-install.tpl
# (app-builder-lib/templates/linux/after-install.tpl) with one deliberate
# change: chrome-sandbox is ALWAYS given the SUID mode bit instead of only on
# systems where `unshare --user` fails.
#
# Why: Ubuntu 23.10+ restricts unprivileged user namespaces behind AppArmor
# (kernel.apparmor_restrict_unprivileged_userns=1). The stock script chmods the
# sandbox helper to 0755 when user namespaces look available (they are, for
# root, while the postinst runs) and then relies on the AppArmor profile being
# installed in the same script. When that profile step silently no-ops (older
# or newer AppArmor ABI, apparmor_status missing, ...), Chromium cannot create
# its namespace sandbox and the app exits before a window ever opens. The SUID
# helper is Chromium's primary sandbox mechanism and works regardless of the
# userns policy, so the app starts either way. The AppArmor profile install
# below is kept as a second layer.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Chromium's SUID sandbox helper: works with or without unprivileged user
# namespaces, so it covers Ubuntu 23.10+ (userns restricted) and older
# releases alike. dpkg extracts as root:root already.
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi
