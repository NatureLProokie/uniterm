//go:build !android

package log

import (
	"os"
	"path/filepath"
)

// logPath returns the desktop log location (~/.uniterm/uniterm.log).
func logPath() string {
	if overridePath != "" {
		return overridePath
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "uniterm.log"
	}
	return filepath.Join(home, ".uniterm", "uniterm.log")
}
