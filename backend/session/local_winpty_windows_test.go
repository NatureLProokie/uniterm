//go:build windows

package session

import "testing"

// The Win7 path must fail cleanly (and let Connect fall through to pipes)
// when the runtime files are not next to the sidecar.
func TestStartWinPTYMissingRuntime(t *testing.T) {
	t.Setenv("UNITERM_WINPTY_DIR", t.TempDir())
	if _, err := startWinPTY("cmd.exe", `C:\`, nil, 80, 24); err == nil {
		t.Fatal("startWinPTY succeeded without winpty.dll/winpty-agent.exe")
	}
}
