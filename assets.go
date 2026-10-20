package main

import _ "embed"

// Tray icons kept for the platform helpers. The Electron host draws the
// window; only the sidecar's own assets live here.
//
//go:embed build/appicon_tray.png
var appIconTrayPNG []byte

//go:embed build/appicon_tray_template.png
var appIconTrayTemplatePNG []byte
