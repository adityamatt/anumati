import { describe, it, expect } from "vitest";
import { matchGo } from "../../src/matchers/go.js";

describe("matchGo — allowed", () => {
  it("matches go build ./...", () => expect(matchGo("go build ./...")).toBe(true));
  it("matches go test ./...", () => expect(matchGo("go test ./...")).toBe(true));
  it("matches go vet ./...", () => expect(matchGo("go vet ./...")).toBe(true));
  it("matches go fmt ./...", () => expect(matchGo("go fmt ./...")).toBe(true));
  it("matches go list ./...", () => expect(matchGo("go list ./...")).toBe(true));
  it("matches go doc fmt.Println", () => expect(matchGo("go doc fmt.Println")).toBe(true));
  it("matches go version", () => expect(matchGo("go version")).toBe(true));
  it("matches go env", () => expect(matchGo("go env")).toBe(true));
  it("matches go env GOPATH", () => expect(matchGo("go env GOPATH")).toBe(true));
  it("matches go mod graph", () => expect(matchGo("go mod graph")).toBe(true));
  it("matches go mod verify", () => expect(matchGo("go mod verify")).toBe(true));
  it("matches go mod why", () => expect(matchGo("go mod why example.com/x")).toBe(true));
  it("matches go mod download", () => expect(matchGo("go mod download")).toBe(true));
  it("matches go mod edit -print", () => expect(matchGo("go mod edit -print")).toBe(true));
  it("matches cd dir && go build ./...", () => expect(matchGo("cd ./svc && go build ./...")).toBe(true));
  it("matches go list piped to grep", () => expect(matchGo("go list ./... | grep internal")).toBe(true));
  it("matches gofmt -l .", () => expect(matchGo("gofmt -l .")).toBe(true));
});

describe("matchGo — blocked", () => {
  it("blocks go run main.go", () => expect(matchGo("go run main.go")).toBe(false));
  it("blocks go install ./cmd/foo", () => expect(matchGo("go install ./cmd/foo")).toBe(false));
  it("blocks go get", () => expect(matchGo("go get github.com/x/y")).toBe(false));
  it("blocks go generate ./...", () => expect(matchGo("go generate ./...")).toBe(false));
  it("blocks go clean", () => expect(matchGo("go clean")).toBe(false));
  it("blocks go mod tidy", () => expect(matchGo("go mod tidy")).toBe(false));
  it("blocks go mod init", () => expect(matchGo("go mod init x")).toBe(false));
  it("blocks go mod vendor", () => expect(matchGo("go mod vendor")).toBe(false));
  it("blocks go mod edit without -print", () => expect(matchGo("go mod edit -require=x@v1")).toBe(false));
  it("blocks go env -w", () => expect(matchGo("go env -w GOFLAGS=-mod=mod")).toBe(false));
  it("blocks go env -u", () => expect(matchGo("go env -u GOFLAGS")).toBe(false));
  it("blocks go tool pprof", () => expect(matchGo("go tool pprof")).toBe(false));
  it("blocks go work sync", () => expect(matchGo("go work sync")).toBe(false));
  it("blocks gofmt -w .", () => expect(matchGo("gofmt -w .")).toBe(false));
  it("blocks go build chained with rm", () => expect(matchGo("go build && rm -rf /")).toBe(false));
  it("blocks go build with redirection", () => expect(matchGo("go build > out")).toBe(false));
  it("blocks go test -exec", () => expect(matchGo("go test -exec sudo ./...")).toBe(false));
  it("blocks subshell expansion", () => expect(matchGo("go $(echo build)")).toBe(false));
  it("blocks semicolon chaining", () => expect(matchGo("go build ; rm -rf /")).toBe(false));
  it("blocks background operator", () => expect(matchGo("go build & echo done")).toBe(false));
  it("blocks pipe to unsafe builtin", () => expect(matchGo("go list ./... | sh")).toBe(false));
});
