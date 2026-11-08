// Command lightgram serves previewable lightgram links.
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

	"lightgram/backend/internal/share"
	"lightgram/backend/internal/web"
)

func main() {
	var (
		addr       = flag.String("addr", "127.0.0.1", "interface to listen on; loopback by default, because this server reads untrusted links")
		port       = flag.Int("port", 8080, "port to listen on")
		dev        = flag.Bool("dev", false, "proxy to the Vite dev server and disable caching")
		proxy      = flag.String("proxy", "http://localhost:5174", "Vite dev server address (dev only)")
		shell      = flag.String("shell", "../frontend/index.html", "app shell served in dev")
		static     = flag.String("static", "../frontend/dist", "built site served outside dev")
		maxPayload = flag.Int("max-payload", 64<<10, "largest decoded document, in bytes")
		publicURL  = flag.String("public-origin", "", "origin every generated URL claims, e.g. https://lightgram.example.com")
		trustProxy = flag.Bool("trust-proxy", false, "believe X-Forwarded-Proto/-Host; only behind a proxy you control")
	)
	flag.Parse()

	config := web.Config{
		Dev:             *dev,
		ShellPath:       *shell,
		StaticDir:       *static,
		MaxPayloadBytes: *maxPayload,
		PublicOrigin:    *publicURL,
		TrustProxy:      *trustProxy,
		Log:             log.New(os.Stderr, "lightgram ", log.LstdFlags|log.Lmsgprefix),
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
