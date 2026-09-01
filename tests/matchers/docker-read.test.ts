import { describe, it, expect } from "vitest";
import { matchDockerRead } from "../../src/matchers/docker-read.js";

describe("matchDockerRead — allow (read-only)", () => {
  // The real triage example: DOCKER_HOST prefix + `docker ps` piped to head.
  it("DOCKER_HOST prefix, docker ps --format, piped to head", () =>
    expect(
      matchDockerRead(
        "DOCKER_HOST=unix:///Users/uneet/.orbstack/run/docker.sock docker ps --format '{{.Names}}' | head -5",
      ),
    ).toBe(true));

  it("docker ps", () => expect(matchDockerRead("docker ps")).toBe(true));
  it("docker ps -a", () => expect(matchDockerRead("docker ps -a")).toBe(true));
  it("docker images", () => expect(matchDockerRead("docker images")).toBe(true));
  it("docker image ls", () => expect(matchDockerRead("docker image ls")).toBe(true));
  it("docker inspect <name>", () => expect(matchDockerRead("docker inspect web")).toBe(true));
  it("docker version", () => expect(matchDockerRead("docker version")).toBe(true));
  it("docker info", () => expect(matchDockerRead("docker info")).toBe(true));
  it("docker top <name>", () => expect(matchDockerRead("docker top web")).toBe(true));
  it("docker port <name>", () => expect(matchDockerRead("docker port web")).toBe(true));
  it("docker logs (no follow)", () => expect(matchDockerRead("docker logs web")).toBe(true));
  it("docker logs --tail 100", () => expect(matchDockerRead("docker logs --tail 100 web")).toBe(true));
  it("docker stats --no-stream", () => expect(matchDockerRead("docker stats --no-stream")).toBe(true));
  it("multiple docker env vars", () =>
    expect(matchDockerRead("DOCKER_HOST=tcp://x DOCKER_TLS_VERIFY=1 docker ps")).toBe(true));
  it("piped to a safe consumer", () => expect(matchDockerRead("docker ps | grep web")).toBe(true));
});

describe("matchDockerRead — block mutating / exec / network subcommands", () => {
  it("run", () => expect(matchDockerRead("docker run -it ubuntu bash")).toBe(false));
  it("exec", () => expect(matchDockerRead("docker exec -it web sh")).toBe(false));
  it("rm", () => expect(matchDockerRead("docker rm web")).toBe(false));
  it("rmi", () => expect(matchDockerRead("docker rmi img")).toBe(false));
  it("build", () => expect(matchDockerRead("docker build .")).toBe(false));
  it("create", () => expect(matchDockerRead("docker create ubuntu")).toBe(false));
  it("start", () => expect(matchDockerRead("docker start web")).toBe(false));
  it("stop", () => expect(matchDockerRead("docker stop web")).toBe(false));
  it("restart", () => expect(matchDockerRead("docker restart web")).toBe(false));
  it("kill", () => expect(matchDockerRead("docker kill web")).toBe(false));
  it("cp", () => expect(matchDockerRead("docker cp web:/etc/passwd .")).toBe(false));
  it("commit", () => expect(matchDockerRead("docker commit web img")).toBe(false));
  it("tag", () => expect(matchDockerRead("docker tag a b")).toBe(false));
  it("push", () => expect(matchDockerRead("docker push img")).toBe(false));
  it("pull", () => expect(matchDockerRead("docker pull img")).toBe(false));
  it("save", () => expect(matchDockerRead("docker save img")).toBe(false));
  it("load", () => expect(matchDockerRead("docker load")).toBe(false));
  it("export", () => expect(matchDockerRead("docker export web")).toBe(false));
  it("import", () => expect(matchDockerRead("docker import f.tar")).toBe(false));
  it("login", () => expect(matchDockerRead("docker login")).toBe(false));
  it("system prune", () => expect(matchDockerRead("docker system prune -f")).toBe(false));
  it("volume create", () => expect(matchDockerRead("docker volume create x")).toBe(false));
  it("volume rm", () => expect(matchDockerRead("docker volume rm x")).toBe(false));
  it("network create", () => expect(matchDockerRead("docker network create x")).toBe(false));
  it("compose up", () => expect(matchDockerRead("docker compose up")).toBe(false));
  it("image rm (not ls)", () => expect(matchDockerRead("docker image rm img")).toBe(false));
  it("image prune", () => expect(matchDockerRead("docker image prune")).toBe(false));
});

describe("matchDockerRead — block long-running / interactive forms", () => {
  it("logs -f", () => expect(matchDockerRead("docker logs -f web")).toBe(false));
  it("logs --follow", () => expect(matchDockerRead("docker logs --follow web")).toBe(false));
  it("stats without --no-stream", () => expect(matchDockerRead("docker stats")).toBe(false));
  it("attach", () => expect(matchDockerRead("docker attach web")).toBe(false));
  it("events", () => expect(matchDockerRead("docker events")).toBe(false));
  it("wait", () => expect(matchDockerRead("docker wait web")).toBe(false));
});

describe("matchDockerRead — block untrusted env prefix", () => {
  it("LD_PRELOAD", () => expect(matchDockerRead("LD_PRELOAD=/tmp/evil.so docker ps")).toBe(false));
  it("PATH", () => expect(matchDockerRead("PATH=/tmp docker ps")).toBe(false));
  it("arbitrary VAR", () => expect(matchDockerRead("FOO=bar docker ps")).toBe(false));
  it("env launcher", () => expect(matchDockerRead("env docker ps")).toBe(false));
});

describe("matchDockerRead — block dangerous shapes", () => {
  it("file redirection", () => expect(matchDockerRead("docker ps > out.txt")).toBe(false));
  it("pipe to unsafe consumer", () => expect(matchDockerRead("docker ps | sh")).toBe(false));
  it("chained && (single command only)", () => expect(matchDockerRead("docker ps && rm x")).toBe(false));
  it("command substitution", () => expect(matchDockerRead("docker inspect $(cat id)")).toBe(false));
  it("bare docker (no subcommand)", () => expect(matchDockerRead("docker")).toBe(false));
  it("not docker", () => expect(matchDockerRead("podman ps")).toBe(false));
  it("empty", () => expect(matchDockerRead("")).toBe(false));
});
