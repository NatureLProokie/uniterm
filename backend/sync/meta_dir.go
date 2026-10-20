package sync

// metaDirOverride pins the directory holding sync metadata (sync-config.json
// and the local snapshot repo clone). The Win7 sidecar sets it so its sync repo
// never shares %APPDATA%\uniTerm with the Wails build — two builds syncing one
// remote would overwrite each other's config.
var metaDirOverride string

// SetMetaDir pins the sync metadata directory. Empty restores the platform
// default. Call before NewSyncService.
func SetMetaDir(dir string) { metaDirOverride = dir }
