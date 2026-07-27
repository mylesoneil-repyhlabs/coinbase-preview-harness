import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const INSTALL = path.join(ROOT, "install");
const SKILL_SOURCE = path.join(ROOT, "skills", "delta-coinbase-guard");

function installEnvironment(home) {
  const environment = {
    ...process.env,
    HOME: home,
    CODEX_HOME: "",
    HARNESS_NODE_BINARY: process.execPath,
    PATH: "/usr/bin:/bin",
  };
  return environment;
}

test("fresh install uses the documented user-local skills directory", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "coinbase-guard-home-"));
  try {
    const { stdout } = await execFileAsync(INSTALL, [], {
      env: installEnvironment(home),
      timeout: 20_000,
    });
    const target = path.join(
      home,
      ".agents",
      "skills",
      "delta-coinbase-guard",
    );
    assert.match(stdout, /Installed Delta Coinbase Guard/);
    assert.equal(await realpath(target), await realpath(SKILL_SOURCE));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("explicit upgrade atomically retargets only a verified guard symlink", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "coinbase-guard-upgrade-"));
  try {
    const oldSource = path.join(home, "old-release", "skill");
    const skillsRoot = path.join(home, ".agents", "skills");
    const target = path.join(skillsRoot, "delta-coinbase-guard");
    await mkdir(oldSource, { recursive: true });
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(
      path.join(oldSource, "SKILL.md"),
      "---\nname: delta-coinbase-guard\n---\n",
      "utf8",
    );
    await symlink(oldSource, target);

    await assert.rejects(
      execFileAsync(INSTALL, [], {
        env: installEnvironment(home),
        timeout: 20_000,
      }),
      /rerun: .* --upgrade/,
    );
    assert.equal(await readlink(target), oldSource);

    const { stdout } = await execFileAsync(INSTALL, ["--upgrade"], {
      env: installEnvironment(home),
      timeout: 20_000,
    });
    assert.match(stdout, /Upgraded Delta Coinbase Guard/);
    assert.equal(await realpath(target), await realpath(SKILL_SOURCE));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("upgrade refuses a symlink that is not a Delta Coinbase Guard skill", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "coinbase-guard-refuse-"));
  try {
    const unrelatedSource = path.join(home, "unrelated-skill");
    const skillsRoot = path.join(home, ".agents", "skills");
    const target = path.join(skillsRoot, "delta-coinbase-guard");
    await mkdir(unrelatedSource, { recursive: true });
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(
      path.join(unrelatedSource, "SKILL.md"),
      "---\nname: unrelated-skill\n---\n",
      "utf8",
    );
    await symlink(unrelatedSource, target);

    await assert.rejects(
      execFileAsync(INSTALL, ["--upgrade"], {
        env: installEnvironment(home),
        timeout: 20_000,
      }),
      /Refusing to replace the existing path/,
    );
    assert.equal(await readlink(target), unrelatedSource);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
