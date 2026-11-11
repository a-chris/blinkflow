// Command blinkflow serves previewable blinkflow links.
//
// The document lives in the URL, so there is nothing to store: a request is
// decoded, described in three meta tags, and answered with the app shell. The
// browser then decodes the same payload again and draws the diagram.
//
// In dev it also reverse-proxies everything that is not a payload to Vite, so
// one origin serves both the editor and the cards:
//
//	make dev            # from the repo root
//	open http://localhost:8080
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"blinkflow/backend/internal/share"
	"blinkflow/backend/internal/web"
)

func main() {
	// Every flag a deployment has to set also reads an environment variable, so a
	// container is configured by its environment and a flag still wins when one
	// is passed. The defaults are the developer story: a loopback listener in
	// front of frontend/dist, exactly what `make dev` uses.
	var (
		addr       = flag.String("addr", envString("BLINKFLOW_ADDR", "127.0.0.1"), "interface to listen on; loopback by default, because this server reads untrusted links")
		port       = flag.Int("port", envInt("BLINKFLOW_PORT", 8080), "port to listen on")
		dev        = flag.Bool("dev", false, "proxy to the Vite dev server and disable caching")
		proxy      = flag.String("proxy", "http://localhost:5174", "Vite dev server address (dev only)")
		shell      = flag.String("shell", "../frontend/index.html", "app shell served in dev")
		static     = flag.String("static", envString("BLINKFLOW_STATIC", "../frontend/dist"), "built site served outside dev")
		skillsDir  = flag.String("skills", envString("BLINKFLOW_SKILLS", "../skills"), "agent skills served at /skills/; empty disables it")
		maxPayload = flag.Int("max-payload", envInt("BLINKFLOW_MAX_PAYLOAD", 64<<10), "largest decoded document, in bytes")
		publicURL  = flag.String("public-origin", envString("BLINKFLOW_PUBLIC_ORIGIN", ""), "origin every generated URL claims, e.g. https://blinkflow.example.com")
		trustProxy = flag.Bool("trust-proxy", envBool("BLINKFLOW_TRUST_PROXY", false), "believe X-Forwarded-Proto/-Host; only behind a proxy you control")
	)
	flag.Parse()

	config := web.Config{
		Dev:             *dev,
		ShellPath:       *shell,
		StaticDir:       *static,
		SkillsDir:       *skillsDir,
		MaxPayloadBytes: *maxPayload,
		PublicOrigin:    *publicURL,
		TrustProxy:      *trustProxy,
		Log:             log.New(os.Stderr, "blinkflow ", log.LstdFlags|log.Lmsgprefix),
	}

	if *dev {
		target, err := url.Parse(*proxy)
		if err != nil || target.Host == "" {
			config.Log.Fatalf("bad -proxy %q", *proxy)
		}
		config.Proxy = target
	}

	handler, err := web.New(config)
	if err != nil {
		config.Log.Fatalf("%v", err)
	}

	server := &http.Server{
		Addr:              net.JoinHostPort(*addr, strconv.Itoa(*port)),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		// A share URL is a request line, so the header limit has to be able to
		// hold the longest payload the document cap allows - plus room for
		// ordinary headers. Go answers 431 past this.
		MaxHeaderBytes: share.MaxEncoded(*maxPayload) + 16<<10,
	}

	config.Log.Printf("http://localhost:%d (dev=%v)", *port, *dev)
	if *dev {
		config.Log.Printf("proxying everything that is not a payload to %s", *proxy)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			config.Log.Fatalf("%v", err)
		}
	}()

	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
}

// envString returns the environment value, or the fallback when it is unset or
// empty. Empty means unset: a compose file that interpolates a missing variable
// must not silently disable a default.
func envString(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	return fallback
}

// envInt reads a numeric setting, and refuses to guess: a typo such as
// BLINKFLOW_PORT=808O has to stop the container, not fall back to 8080 and leave
// the operator wondering which port is listening.
func envInt(key string, fallback int) int {
	value, ok := os.LookupEnv(key)
	if !ok || value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		log.Fatalf("%s=%q is not a number", key, value)
	}
	return parsed
}

func envBool(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok || value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		log.Fatalf("%s=%q is not true or false", key, value)
	}
	return parsed
}
