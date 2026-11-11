package web_test

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"blinkflow/backend/internal/web"
)

// skillsDir is the real folder, three levels up from this package. The point of
// this file is that the thing an agent fetches over HTTP is the thing in the
// repository, so at least one test has to look at the repository.
var skillsDir = filepath.Join("..", "..", "..", "skills")

func skillsHarness(t *testing.T, dir string) http.Handler {
	t.Helper()
	server, _ := harness(t, web.Config{Dev: true, SkillsDir: dir})
	return server
}

func TestSkillsServeTheRealSkill(t *testing.T) {
	server := skillsHarness(t, skillsDir)

	response := get(t, server, "/skills/explain-code-flow/SKILL.md")

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/markdown") {
		t.Fatalf("Content-Type = %q, want text/markdown", got)
	}
	body := response.Body.String()
	for _, want := range []string{"name: explain-code-flow", "POST https://blinkflow.live/share", "Never"} {
		if !strings.Contains(body, want) {
			t.Fatalf("the served skill is missing %q", want)
		}
	}
}

func TestSkillsServeTheExamplesAsText(t *testing.T) {
	server := skillsHarness(t, skillsDir)

	for _, name := range []string{"code-native.lg", "pseudocode.lg", "concept.lg"} {
		response := get(t, server, "/skills/explain-code-flow/examples/"+name)
		if response.Code != http.StatusOK {
			t.Fatalf("%s: status %d", name, response.Code)
		}
		// A diagram example that downloads instead of displaying is useless to
		// whatever is reading it.
		if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/plain") {
			t.Fatalf("%s: Content-Type = %q, want text/plain", name, got)
		}
	}
}

// An agent that cannot guess the file names needs to see the tree.
func TestSkillsListing(t *testing.T) {
	server := skillsHarness(t, skillsDir)

	response := get(t, server, "/skills/")

	if response.Code != http.StatusOK {
		t.Fatalf("status %d", response.Code)
	}
	for _, want := range []string{"README.md", "explain-code-flow"} {
		if !strings.Contains(response.Body.String(), want) {
			t.Fatalf("the listing is missing %q", want)
		}
	}
}

func TestSkillsRedirectTheBarePrefix(t *testing.T) {
	server := skillsHarness(t, skillsDir)

	response := get(t, server, "/skills")

	if response.Code != http.StatusMovedPermanently {
		t.Fatalf("status %d, want 301", response.Code)
	}
	if got := response.Header().Get("Location"); got != "/skills/" {
		t.Fatalf("Location = %q", got)
	}
}

// The folder is served from disk, so the one thing that must not be possible is
// reading anything outside it.
func TestSkillsCannotEscapeTheirDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("# inside"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "outside-secret.txt"), []byte("do not serve"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	server := skillsHarness(t, dir)

	for _, target := range []string{
		"/skills/../outside-secret.txt",
		"/skills/../../outside-secret.txt",
		"/skills/%2e%2e/outside-secret.txt",
		"/skills/..%2foutside-secret.txt",
	} {
		response := get(t, server, target)
		if strings.Contains(response.Body.String(), "do not serve") {
			t.Fatalf("%s escaped the skills directory: %q", target, response.Body.String())
		}
	}
}

func TestSkillsAreReadOnly(t *testing.T) {
	server := skillsHarness(t, skillsDir)

	response := postTo(t, server, "/skills/explain-code-flow/SKILL.md", "text/plain", "overwrite me")

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d, want 405", response.Code)
	}
}

// /share accepts a body; /skills must not be routed there by accident.
func TestSkillsDoNotShadowTheShareEndpoint(t *testing.T) {
	server := skillsHarness(t, skillsDir)

	response := post(t, server, "text/plain", shareDocument)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
}

func TestSkillsAreOptional(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	// With no folder configured the path is not special, so dev proxies it and
	// production falls back to the app shell — either way it is not a file read.
	response := get(t, server, "/skills/explain-code-flow/SKILL.md")
	if strings.Contains(response.Body.String(), "name: explain-code-flow") {
		t.Fatal("with no skills dir configured nothing should be served")
	}
}

func TestMissingSkillsDirectoryFailsFast(t *testing.T) {
	config := web.Config{Dev: true, SkillsDir: filepath.Join(t.TempDir(), "nope")}
	if _, err := web.New(config); err == nil {
		t.Fatal("a skills dir that does not exist must fail at startup, not at request time")
	}
}
