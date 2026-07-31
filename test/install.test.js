import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
const PACKAGE_VERSION = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8"),
).version;
const INSTALL_PAYLOAD = [
  ".nvmrc",
  "README.md",
  "SECURITY.md",
  "config",
  "docs",
  "examples",
  "install",
  "output",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "run",
  "scripts",
  "skills",
  "src",
  "web",
];

function installEnvironment(home, overrides = {}) {
  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: "",
    XDG_DATA_HOME: "",
    HARNESS_NODE_BINARY: process.execPath,
    PATH: "/usr/bin:/bin",
    ...overrides,
  };
}

function managedHarness(home, dataRoot = path.join(home, ".local", "share")) {
  return path.join(
    dataRoot,
    "delta",
    "coinbase-guard",
    "versions",
    `v${PACKAGE_VERSION}`,
  );
}

function installedSkill(home) {
  return path.join(
    home,
    ".agents",
    "skills",
    "delta-coinbase-guard",
  );
}

async function copyDownloadedRelease(destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of INSTALL_PAYLOAD) {
    await cp(path.join(ROOT, entry), path.join(destination, entry), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

test("fresh install creates a managed version and an atomic skill link", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "coinbase-guard-home-"));
  try {
    const { stdout } = await execFileAsync(INSTALL, [], {
      env: installEnvironment(home),
      timeout: 20_000,
    });
    const harness = managedHarness(home);
    const target = installedSkill(home);
    assert.match(stdout, /Installed Delta Coinbase Guard/);
    assert.match(stdout, /managed, versioned local copy/i);
    assert.equal(
      await realpath(target),
      await realpath(path.join(harness, "skills", "delta-coinbase-guard")),
    );
    assert.notEqual(
      await realpath(target),
      await realpath(path.join(ROOT, "skills", "delta-coinbase-guard")),
    );
    const marker = JSON.parse(
      await readFile(
        path.join(harness, ".delta-coinbase-guard-install.json"),
        "utf8",
      ),
    );
    assert.equal(marker.version, PACKAGE_VERSION);
    assert.equal(marker.product, "delta-coinbase-guard");
    assert.ok(marker.files.length > 20);
    assert.equal(
      (await lstat(path.join(harness, ".delta-coinbase-guard-node"))).isFile(),
      true,
    );
    await access(path.join(harness, "src", "advisor-server.js"));
    await access(path.join(harness, "web", "index.html"));
    await assert.rejects(access(path.join(harness, "docs", "MASTRA-PARTNER-BRIEF.md")));
    await assert.rejects(access(path.join(harness, "examples", "mastra")));
    await assert.rejects(access(path.join(harness, "output", "mastra")));
    await assert.rejects(access(path.join(harness, "src", "mastra-partner.js")));
    await assert.rejects(access(path.join(harness, "src", "partner-demo.js")));
    await assert.rejects(
      access(
        path.join(
          harness,
          "scripts",
          "generate-mastra-partner-assets.mjs",
        ),
      ),
    );
    const managedPackage = JSON.parse(
      await readFile(path.join(harness, "package.json"), "utf8"),
    );
    assert.equal(
      Object.keys(managedPackage.scripts).some((name) =>
        name.toLowerCase().includes("mastra"),
      ),
      false,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("fresh Codex install discovers bundled Node when login PATH has no node", async () => {
  const home = await mkdtemp(
    path.join(os.tmpdir(), "coinbase-guard-codex-runtime-"),
  );
  try {
    const bundledNode = path.join(
      home,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "bin",
      "node",
    );
    await mkdir(path.dirname(bundledNode), { recursive: true });
    await symlink(process.execPath, bundledNode);

    const { stdout, stderr } = await execFileAsync(INSTALL, [], {
      env: installEnvironment(home, { HARNESS_NODE_BINARY: "" }),
      timeout: 20_000,
    });

    assert.match(stdout, /Installed Delta Coinbase Guard/);
    assert.match(stdout, /Node\.js.*PASS/s);
    assert.equal(stderr, "");
    assert.equal(
      await realpath(installedSkill(home)),
      await realpath(
        path.join(
          managedHarness(home),
          "skills",
          "delta-coinbase-guard",
        ),
      ),
    );
    assert.equal(
      (
        await readFile(
          path.join(managedHarness(home), ".delta-coinbase-guard-node"),
          "utf8",
        )
      ).trim(),
      await realpath(process.execPath),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("source launcher discovers bundled Codex Node on a restricted PATH", async () => {
  const home = await mkdtemp(
    path.join(os.tmpdir(), "coinbase-guard-source-runtime-"),
  );
  try {
    const bundledNode = path.join(
      home,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "bin",
      "node",
    );
    await mkdir(path.dirname(bundledNode), { recursive: true });
    await symlink(process.execPath, bundledNode);

    const { stdout, stderr } = await execFileAsync(
      path.join(ROOT, "run"),
      ["version"],
      {
        env: installEnvironment(home, {
          HARNESS_NODE_BINARY: "",
        }),
        timeout: 10_000,
      },
    );
    assert.equal(stdout.trim(), PACKAGE_VERSION);
    assert.equal(stderr, "");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("rerunning the same release is idempotent and keeps older versions", async () => {
  const home = await mkdtemp(
    path.join(os.tmpdir(), "coinbase-guard-idempotent-"),
  );
  try {
    const versionsRoot = path.dirname(managedHarness(home));
    const oldVersion = path.join(versionsRoot, "v0.9.0");
    await mkdir(oldVersion, { recursive: true });
    await writeFile(path.join(oldVersion, "keep-me"), "preserved\n", "utf8");

    await execFileAsync(INSTALL, [], {
      env: installEnvironment(home),
      timeout: 20_000,
    });
    const target = installedSkill(home);
    const firstLink = await readlink(target);
    const { stdout } = await execFileAsync(INSTALL, [], {
      env: installEnvironment(home),
      timeout: 20_000,
    });

    assert.match(stdout, /already installed/);
    assert.equal(await readlink(target), firstLink);
    assert.equal(
      await readFile(path.join(oldVersion, "keep-me"), "utf8"),
      "preserved\n",
    );
    assert.deepEqual(
      (await readdir(versionsRoot)).sort(),
      [`v${PACKAGE_VERSION}`, "v0.9.0"].sort(),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("installed skill survives deletion of the downloaded release", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "coinbase-guard-download-"),
  );
  const home = path.join(temporaryRoot, "home");
  const release = path.join(temporaryRoot, "downloaded-release");
  const xdgData = path.join(temporaryRoot, "xdg-data");
  try {
    await mkdir(home, { recursive: true });
    await copyDownloadedRelease(release);
    const { stdout: installStdout } = await execFileAsync(
      path.join(release, "install"),
      [],
      {
        env: installEnvironment(home, { XDG_DATA_HOME: xdgData }),
        timeout: 20_000,
      },
    );

    assert.match(installStdout, /\$delta-coinbase-guard/);
    assert.match(
      installStdout,
      /protected spot BUY or SELL dry run/i,
    );
    assert.match(installStdout, /Authorize this mandate/);
    assert.match(installStdout, /PASS\/BLOCK\/REVIEW/);
    assert.match(installStdout, /No order can be sent/i);
    assert.doesNotMatch(installStdout, /docs\//i);
    assert.doesNotMatch(
      installStdout,
      /digest authorization|exact PASS gate/i,
    );

    const target = installedSkill(home);
    const harness = managedHarness(home, xdgData);
    assert.equal(
      await realpath(target),
      await realpath(path.join(harness, "skills", "delta-coinbase-guard")),
    );

    await writeFile(
      path.join(release, "README.md"),
      "same version, different payload\n",
      "utf8",
    );
    await assert.rejects(
      execFileAsync(path.join(release, "install"), [], {
        env: installEnvironment(home, { XDG_DATA_HOME: xdgData }),
        timeout: 20_000,
      }),
      /managed version does not match the source release payload/,
    );

    await rm(release, { recursive: true, force: true });
    await assert.rejects(access(release));
    const { stdout, stderr } = await execFileAsync(
      path.join(target, "scripts", "run"),
      ["doctor"],
      {
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
        },
        timeout: 20_000,
      },
    );
    assert.match(stdout, /Node\.js.*PASS/s);
    assert.match(stdout, /Real Coinbase Create.*LOCKED/s);
    assert.equal(stderr, "");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("installer refuses secret material added inside an otherwise allowlisted source path", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "coinbase-guard-secret-source-"),
  );
  const home = path.join(temporaryRoot, "home");
  const release = path.join(temporaryRoot, "downloaded-release");
  try {
    await mkdir(home, { recursive: true });
    await copyDownloadedRelease(release);
    const copiedExample = path.join(
      release,
      "examples",
      "conditional-buy-intent.txt",
    );
    await writeFile(
      copiedExample,
      `${await readFile(copiedExample, "utf8")}\n${[
        "-----BEGIN ",
        "PRIVATE KEY-----",
      ].join("")}\nnot-a-real-key\n`,
      "utf8",
    );
    await assert.rejects(
      execFileAsync(path.join(release, "install"), [], {
        env: installEnvironment(home),
        timeout: 20_000,
      }),
      /private-key material/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
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
    assert.equal(
      await realpath(target),
      await realpath(
        path.join(
          managedHarness(home),
          "skills",
          "delta-coinbase-guard",
        ),
      ),
    );
    assert.equal(
      await readFile(path.join(oldSource, "SKILL.md"), "utf8"),
      "---\nname: delta-coinbase-guard\n---\n",
    );
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

test("installer refuses to reuse an unverified managed version", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "coinbase-guard-tamper-"));
  try {
    const harness = managedHarness(home);
    await mkdir(harness, { recursive: true });
    await writeFile(
      path.join(harness, ".delta-coinbase-guard-install.json"),
      "{}\n",
      "utf8",
    );

    await assert.rejects(
      execFileAsync(INSTALL, [], {
        env: installEnvironment(home),
        timeout: 20_000,
      }),
      /managed harness identity does not match this release/,
    );
    await assert.rejects(access(installedSkill(home)));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
