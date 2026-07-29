import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_COMMAND_SCHEMAS,
  CliUsageError,
  parseCliArguments,
} from "../src/cli-args.js";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(TEST_DIR, "../src/cli.js");

const VALID_COMMAND_SURFACES = [
  ["help", [], "help"],
  ["--help", [], "help"],
  ["version", [], "version"],
  ["--version", [], "version"],
  ["doctor", [], "doctor"],
  ["credential-readiness", [], "credential-readiness"],
  [
    "configure-credentials",
    ["--key-file", "/outside/view.json"],
    "configure-preview-credentials",
  ],
  [
    "configure-preview-credentials",
    ["--key-file", "/outside/view.json"],
    "configure-preview-credentials",
  ],
  [
    "configure-executor-credentials",
    ["--key-file", "/outside/trade.json"],
    "configure-executor-credentials",
  ],
  ["coinbase-demo", ["--no-artifacts"], "coinbase-demo"],
  ["mastra-demo", ["--scenario", "review"], "mastra-demo"],
  [
    "plan",
    ["--intent", "Buy exactly 10 USDC of SOL", "--compiler", "deterministic"],
    "plan",
  ],
  [
    "simulate",
    ["--plan", "/tmp/plan.json", "--confirm-policy", "abc123"],
    "simulate",
  ],
  [
    "configure-execution",
    ["--key-file", "/outside/trade.json"],
    "configure-execution",
  ],
  [
    "bind-execution",
    [
      "--plan",
      "/tmp/plan.json",
      "--confirm-policy",
      "abc123",
      "--key-file",
      "/outside/view.json",
      "--credential-role",
      "preview",
    ],
    "bind-execution",
  ],
  [
    "confirm-execution",
    [
      "--bound-execution",
      "/tmp/bound.json",
      "--confirm-execution",
      "abc123",
      "--key-file",
      "/outside/view.json",
    ],
    "confirm-execution",
  ],
  [
    "probe-execution",
    [
      "--bound-execution",
      "/tmp/bound.json",
      "--confirmation-receipt",
      "/tmp/receipt.json",
      "--key-file",
      "/outside/view.json",
    ],
    "probe-execution",
  ],
  [
    "execute",
    [
      "--bound-execution",
      "/tmp/bound.json",
      "--confirmation-receipt",
      "/tmp/receipt.json",
      "--key-file",
      "/outside/trade.json",
      "--live-execution",
      "--accept-real-money-risk",
    ],
    "execute",
  ],
  [
    "reconcile-execution",
    [
      "--bound-execution",
      "/tmp/bound.json",
      "--key-file",
      "/outside/trade.json",
    ],
    "reconcile-execution",
  ],
];

function captureUsageError(operation) {
  try {
    operation();
    assert.fail("Expected a CLI usage error");
  } catch (error) {
    assert.ok(error instanceof CliUsageError);
    assert.equal(error.code, "CLI_USAGE_ERROR");
    return error;
  }
}

for (const [command, args, canonicalCommand] of VALID_COMMAND_SURFACES) {
  test(`${command} accepts exactly its declared command surface`, () => {
    const parsed = parseCliArguments(command, args);
    assert.equal(parsed.command, canonicalCommand);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.options), true);
  });

  test(`${command} rejects an unknown option`, () => {
    const error = captureUsageError(() =>
      parseCliArguments(command, [...args, "--not-a-real-option"]),
    );
    assert.match(error.message, /unknown option/);
    assert.doesNotMatch(error.message, /not-a-real-option/);
  });

  test(`${command} rejects an unexpected positional argument`, () => {
    const error = captureUsageError(() =>
      parseCliArguments(command, [...args, "unexpected-private-value"]),
    );
    assert.match(error.message, /unexpected positional argument/);
    assert.doesNotMatch(error.message, /unexpected-private-value/);
  });
}

test("plan accepts the intent-file alternative", () => {
  const parsed = parseCliArguments("plan", [
    "--intent-file",
    "/tmp/intent.txt",
    "--compiler",
    "openai",
  ]);
  assert.equal(parsed.options["--intent-file"], "/tmp/intent.txt");
  assert.equal(parsed.options["--compiler"], "openai");
});

test("safe output flags are explicit and composable", () => {
  assert.deepEqual(
    parseCliArguments("help", ["--all"]).options,
    { "--all": true },
  );
  assert.deepEqual(
    parseCliArguments("doctor", ["--json"]).options,
    { "--json": true },
  );
  assert.deepEqual(
    parseCliArguments("simulate", [
      "--plan",
      "/tmp/plan.json",
      "--confirm-policy",
      "abc123",
      "--no-artifacts",
      "--json",
    ]).options,
    {
      "--plan": "/tmp/plan.json",
      "--confirm-policy": "abc123",
      "--no-artifacts": true,
      "--json": true,
    },
  );
});

test("plan rejects conflicting intent sources", () => {
  const error = captureUsageError(() =>
    parseCliArguments("plan", [
      "--intent",
      "Buy SOL",
      "--intent-file",
      "/tmp/intent.txt",
    ]),
  );
  assert.match(
    error.message,
    /--intent and --intent-file cannot be used together/,
  );
  assert.doesNotMatch(error.message, /Buy SOL|tmp\/intent/);
});

test("plan requires exactly one intent source", () => {
  const error = captureUsageError(() => parseCliArguments("plan", []));
  assert.match(
    error.message,
    /exactly one of --intent or --intent-file is required/,
  );
});

for (const [command, commandSchema] of Object.entries(CLI_COMMAND_SCHEMAS)) {
  for (const [optionName, optionSchema] of Object.entries(
    commandSchema.options,
  )) {
    test(`${command} rejects duplicate ${optionName}`, () => {
      const optionArgs =
        optionSchema.kind === "flag"
          ? [optionName, optionName]
          : [
              optionName,
              optionSchema.choices?.[0] ?? "safe-value",
              optionName,
              optionSchema.choices?.[0] ?? "safe-value",
            ];
      const error = captureUsageError(() =>
        parseCliArguments(command, optionArgs),
      );
      assert.match(error.message, new RegExp(`duplicate option ${optionName}`));
    });

    if (optionSchema.kind === "value") {
      test(`${command} rejects a missing value for ${optionName}`, () => {
        const error = captureUsageError(() =>
          parseCliArguments(command, [optionName]),
        );
        assert.match(
          error.message,
          new RegExp(`option ${optionName} requires a value`),
        );
      });

      test(`${command} rejects an option flag as the value for ${optionName}`, () => {
        const error = captureUsageError(() =>
          parseCliArguments(command, [optionName, "--another-option"]),
        );
        assert.match(
          error.message,
          new RegExp(
            `option ${optionName} cannot use another option as its value`,
          ),
        );
      });
    }
  }
}

const REQUIRED_COMMANDS = [
  "configure-credentials",
  "configure-preview-credentials",
  "configure-executor-credentials",
  "plan",
  "simulate",
  "configure-execution",
  "bind-execution",
  "confirm-execution",
  "probe-execution",
  "execute",
  "reconcile-execution",
];

for (const command of REQUIRED_COMMANDS) {
  test(`${command} rejects an omitted required argument set`, () => {
    const error = captureUsageError(() => parseCliArguments(command, []));
    assert.match(error.message, /required|exactly one/);
    assert.match(error.message, /^CLI_USAGE_ERROR/);
    assert.match(error.message, /\nUsage: /);
  });
}

test("enumerated option values fail closed", () => {
  for (const [command, args] of [
    ["mastra-demo", ["--scenario", "maybe"]],
    [
      "plan",
      ["--intent", "Buy SOL", "--compiler", "non-deterministic"],
    ],
    [
      "bind-execution",
      [
        "--plan",
        "/tmp/plan.json",
        "--confirm-policy",
        "abc123",
        "--key-file",
        "/outside/view.json",
        "--credential-role",
        "agent",
      ],
    ],
  ]) {
    const error = captureUsageError(() => parseCliArguments(command, args));
    assert.match(error.message, /must be one of/);
  }
});

test("unknown command and attacker-controlled tokens are not reflected", () => {
  for (const unknownCommand of [
    "organizations/secret/apiKeys/private",
    "constructor",
    "toString",
    "__proto__",
  ]) {
    const commandError = captureUsageError(() =>
      parseCliArguments(unknownCommand, []),
    );
    assert.equal(
      commandError.message,
      'CLI_USAGE_ERROR: unknown command.\nRun "help" to list commands.',
    );
    assert.doesNotMatch(
      commandError.message,
      /organizations|apiKeys|private|constructor|toString|proto/,
    );
  }

  const optionError = captureUsageError(() =>
    parseCliArguments("doctor", [
      "--Bearer-eyJhbGciOi.secret.signature",
    ]),
  );
  assert.doesNotMatch(optionError.message, /Bearer|eyJ|secret|signature/);
});

test("CLI validates the full argument vector before running a handler", async () => {
  try {
    await execFileAsync(process.execPath, [
      CLI_PATH,
      "plan",
      "--intent",
      "private request text",
      "--not-a-real-option",
    ]);
    assert.fail("CLI unexpectedly accepted an unknown option");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.match(
      error.stderr,
      /^error: CLI_USAGE_ERROR \[plan\]: unknown option\./,
    );
    assert.match(error.stderr, /Usage: plan/);
    assert.doesNotMatch(
      error.stderr,
      /private request text|not-a-real-option/,
    );
  }
});

test("default help presents only the safe journey", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    CLI_PATH,
    "help",
  ]);
  assert.match(stdout, /Safe start:/);
  assert.match(stdout, /Optional View-only Coinbase reads and Preview:/);
  assert.doesNotMatch(stdout, /^\s+execute /m);
  assert.match(stdout, /help --all/);

  const full = await execFileAsync(process.execPath, [
    CLI_PATH,
    "help",
    "--all",
  ]);
  assert.match(full.stdout, /Locked integration\/developer seams:/);
  assert.match(full.stdout, /^\s+execute /m);
});

test("unsupported natural language returns actionable closed-policy guidance", async () => {
  try {
    await execFileAsync(process.execPath, [
      CLI_PATH,
      "plan",
      "--intent",
      "Buy some ETH.",
    ]);
    assert.fail("incomplete intent unexpectedly produced a policy");
  } catch (error) {
    assert.equal(error.code, 2);
    assert.match(error.stdout, /REQUEST NOT READY — NO POLICY WAS CREATED/);
    assert.match(error.stdout, /How to fix it:/);
    assert.match(error.stdout, /exact pair; BUY or SELL/);
    assert.match(error.stdout, /discarded nothing and contacted no service/);
  }
});
