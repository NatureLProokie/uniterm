package main

// Win7 sidecar entry point. Speaks newline-delimited JSON on stdin/stdout;
// the Electron host owns the window, and this process only runs the backend.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"reflect"
	"runtime/debug"
	"strings"
	"sync"
)

var errorType = reflect.TypeOf((*error)(nil)).Elem()

func main() {
	rpc := flag.String("rpc", "", `transport (only "stdio" is supported)`)
	dataDir := flag.String("data-dir", "", "config directory; the Electron host passes its userData dir")
	flag.Parse()
	if *rpc != "stdio" {
		fmt.Fprintln(os.Stderr, "uniterm-win7-backend: --rpc=stdio is required")
		os.Exit(2)
	}

	// stdout carries protocol frames only. Anything else that prints (init
	// warnings, fmt.Printf in shared code) goes to stderr.
	proto := os.Stdout
	os.Stdout = os.Stderr

	srv := &rpcServer{out: proto}
	app := NewApp("")
	app.eventSink = srv.emit
	app.updatesDisabled = true
	srv.app = app

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := app.Startup(ctx, *dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "startup: %v\n", err)
		os.Exit(1)
	}

	srv.serve(os.Stdin)
	app.shutdown()
}

type rpcRequest struct {
	Type   string            `json:"type"`
	ID     json.RawMessage   `json:"id"`
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

type rpcServer struct {
	app *App
	out io.Writer
	mu  sync.Mutex
	wg  sync.WaitGroup
}

func (s *rpcServer) serve(in io.Reader) {
	r := bufio.NewReaderSize(in, 1<<20)
	for {
		line, err := r.ReadBytes('\n')
		if line = bytes.TrimSpace(line); len(line) > 0 {
			var req rpcRequest
			if jerr := json.Unmarshal(line, &req); jerr != nil {
				s.writeError(nil, fmt.Errorf("bad request: %w", jerr))
			} else {
				// Calls can block (connect, transfer); dispatch so terminal
				// input is not stuck behind a slow session.
				s.wg.Add(1)
				go func() {
					defer s.wg.Done()
					s.invoke(&req)
				}()
			}
		}
		if err != nil {
			s.wg.Wait() // stdin closed: answer what is already in flight
			return
		}
	}
}

func (s *rpcServer) invoke(req *rpcRequest) {
	defer func() {
		if r := recover(); r != nil {
			s.writeError(req.ID, fmt.Errorf("panic in %s: %v\n%s", req.Method, r, debug.Stack()))
		}
	}()
	result, err := s.call(req)
	if err != nil {
		s.writeError(req.ID, err)
		return
	}
	s.write(map[string]any{"type": "response", "id": req.ID, "result": result})
}

func (s *rpcServer) call(req *rpcRequest) (any, error) {
	name := req.Method
	if i := strings.LastIndexByte(name, '.'); i >= 0 {
		name = name[i+1:]
	}
	m := reflect.ValueOf(s.app).MethodByName(name)
	if !m.IsValid() {
		return nil, fmt.Errorf("unknown method %q", req.Method)
	}

	mt := m.Type()
	variadic := mt.IsVariadic()
	required := mt.NumIn()
	if variadic {
		required--
	}
	if len(req.Args) < required || (!variadic && len(req.Args) > required) {
		return nil, fmt.Errorf("%s expects %d args, got %d", name, required, len(req.Args))
	}

	in := make([]reflect.Value, 0, len(req.Args))
	for i, raw := range req.Args {
		t := mt.In(i)
		if variadic && i >= required {
			t = mt.In(mt.NumIn() - 1).Elem()
		}
		v := reflect.New(t).Elem()
		if err := json.Unmarshal(raw, v.Addr().Interface()); err != nil {
			return nil, fmt.Errorf("%s arg %d: %w", name, i, err)
		}
		in = append(in, v)
	}

	out := m.Call(in)
	if n := len(out); n > 0 && out[n-1].Type().Implements(errorType) {
		if err, _ := out[n-1].Interface().(error); err != nil {
			return nil, err
		}
		out = out[:n-1]
	}

	switch len(out) {
	case 0:
		return nil, nil
	case 1:
		return out[0].Interface(), nil
	default:
		values := make([]any, len(out))
		for i := range out {
			values[i] = out[i].Interface()
		}
		return values, nil
	}
}

func (s *rpcServer) emit(name string, data ...any) {
	var payload any
	if len(data) > 0 {
		payload = data[0]
	}
	s.write(map[string]any{"type": "event", "event": name, "data": payload})
}

func (s *rpcServer) writeError(id json.RawMessage, err error) {
	s.write(map[string]any{"type": "error", "id": id, "error": err.Error()})
}

func (s *rpcServer) write(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		b, _ = json.Marshal(map[string]any{"type": "error", "id": nil, "error": "marshal: " + err.Error()})
	}
	b = append(b, '\n')
	s.mu.Lock()
	_, _ = s.out.Write(b)
	s.mu.Unlock()
}
