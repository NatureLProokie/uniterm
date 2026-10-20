package main

var Version = "dev"

// devBuild is true for untagged builds; release builds set Version via
// -ldflags "-X main.Version=...".
var devBuild = Version == "dev"
