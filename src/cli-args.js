const value = (placeholder, options = {}) =>
  Object.freeze({
    kind: "value",
    placeholder,
    required: options.required === true,
    choices: options.choices
      ? Object.freeze([...options.choices])
      : undefined,
  });

const flag = () => Object.freeze({ kind: "flag", required: false });

const schema = ({
  command,
  usage,
  options = {},
  exactlyOneOf = [],
}) =>
  Object.freeze({
    command,
    usage,
    options: Object.freeze({ ...options }),
    exactlyOneOf: Object.freeze(
      exactlyOneOf.map((group) => Object.freeze([...group])),
    ),
  });

const HELP = schema({
  command: "help",
  usage: "help [--all]",
  options: {
    "--all": flag(),
  },
});

const VERSION = schema({
  command: "version",
  usage: "version",
});

const CONFIGURE_PREVIEW = schema({
  command: "configure-preview-credentials",
  usage:
    "configure-preview-credentials --key-file /outside/repo/view_key.json",
  options: {
    "--key-file": value("<absolute-key-path>", { required: true }),
  },
});

const CONFIGURE_EXECUTOR = schema({
  command: "configure-executor-credentials",
  usage:
    "configure-executor-credentials --key-file /outside/repo/trade_key.json",
  options: {
    "--key-file": value("<absolute-key-path>", { required: true }),
  },
});

export const CLI_COMMAND_SCHEMAS = Object.freeze({
  help: HELP,
  "--help": HELP,
  version: VERSION,
  "--version": VERSION,
  doctor: schema({
    command: "doctor",
    usage: "doctor [--json]",
    options: {
      "--json": flag(),
    },
  }),
  advisor: schema({
    command: "advisor",
    usage: "advisor",
  }),
  "credential-readiness": schema({
    command: "credential-readiness",
    usage: "credential-readiness",
  }),
  "configure-credentials": CONFIGURE_PREVIEW,
  "configure-preview-credentials": CONFIGURE_PREVIEW,
  "configure-executor-credentials": CONFIGURE_EXECUTOR,
  "coinbase-demo": schema({
    command: "coinbase-demo",
    usage: "coinbase-demo [--no-artifacts]",
    options: {
      "--no-artifacts": flag(),
    },
  }),
  plan: schema({
    command: "plan",
    usage:
      "plan (--intent <text> | --intent-file <path>) [--compiler <deterministic|openai>]",
    options: {
      "--intent": value("<text>"),
      "--intent-file": value("<path>"),
      "--compiler": value("<deterministic|openai>", {
        choices: ["deterministic", "openai"],
      }),
      "--json": flag(),
      "--details": flag(),
    },
    exactlyOneOf: [["--intent", "--intent-file"]],
  }),
  simulate: schema({
    command: "simulate",
    usage:
      "simulate --plan <path> --confirm-policy <digest> [--no-artifacts] [--json]",
    options: {
      "--plan": value("<path>", { required: true }),
      "--confirm-policy": value("<digest>", { required: true }),
      "--no-artifacts": flag(),
      "--json": flag(),
      "--details": flag(),
    },
  }),
  preflight: schema({
    command: "preflight",
    usage:
      "preflight --plan <path> --confirm-policy <digest> [--view-key-file <absolute-path>] [--nonce <retry-nonce>] [--no-artifacts] [--details] [--json]",
    options: {
      "--plan": value("<path>", { required: true }),
      "--confirm-policy": value("<digest>", { required: true }),
      "--view-key-file": value("<absolute-key-path>"),
      "--nonce": value("<retry-nonce>"),
      "--no-artifacts": flag(),
      "--details": flag(),
      "--json": flag(),
    },
  }),
  history: schema({
    command: "history",
    usage: "history [--limit <1-100>] [--clear] [--json]",
    options: {
      "--limit": value("<1-100>"),
      "--clear": flag(),
      "--json": flag(),
    },
  }),
  "configure-execution": schema({
    command: "configure-execution",
    usage: "configure-execution --key-file /outside/repo/cdp_key.json",
    options: {
      "--key-file": value("<absolute-key-path>", { required: true }),
    },
  }),
  "bind-execution": schema({
    command: "bind-execution",
    usage:
      "bind-execution --plan <path> --confirm-policy <digest> --key-file <absolute-key-path> [--credential-role <preview|executor>]",
    options: {
      "--plan": value("<path>", { required: true }),
      "--confirm-policy": value("<digest>", { required: true }),
      "--key-file": value("<absolute-key-path>", { required: true }),
      "--credential-role": value("<preview|executor>", {
        choices: ["preview", "executor"],
      }),
    },
  }),
  "confirm-execution": schema({
    command: "confirm-execution",
    usage:
      "confirm-execution --bound-execution <path> --confirm-execution <digest> --key-file <absolute-key-path>",
    options: {
      "--bound-execution": value("<path>", { required: true }),
      "--confirm-execution": value("<digest>", { required: true }),
      "--key-file": value("<absolute-key-path>", { required: true }),
    },
  }),
  "probe-execution": schema({
    command: "probe-execution",
    usage:
      "probe-execution --bound-execution <path> --confirmation-receipt <path> --key-file <absolute-key-path>",
    options: {
      "--bound-execution": value("<path>", { required: true }),
      "--confirmation-receipt": value("<path>", { required: true }),
      "--key-file": value("<absolute-key-path>", { required: true }),
      "--details": flag(),
    },
  }),
  execute: schema({
    command: "execute",
    usage:
      "execute --bound-execution <path> --confirmation-receipt <path> --key-file <absolute-key-path> --live-execution --accept-real-money-risk",
    options: {
      "--bound-execution": value("<path>", { required: true }),
      "--confirmation-receipt": value("<path>", { required: true }),
      "--key-file": value("<absolute-key-path>", { required: true }),
      "--live-execution": Object.freeze({ kind: "flag", required: true }),
      "--accept-real-money-risk": Object.freeze({
        kind: "flag",
        required: true,
      }),
    },
  }),
  "reconcile-execution": schema({
    command: "reconcile-execution",
    usage:
      "reconcile-execution --bound-execution <path> --key-file <absolute-key-path>",
    options: {
      "--bound-execution": value("<path>", { required: true }),
      "--key-file": value("<absolute-key-path>", { required: true }),
    },
  }),
});

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
    this.code = "CLI_USAGE_ERROR";
  }
}

function usageError(commandSchema, reason) {
  return new CliUsageError(
    `CLI_USAGE_ERROR [${commandSchema.command}]: ${reason}\n` +
      `Usage: ${commandSchema.usage}`,
  );
}

function assertChoice(commandSchema, optionName, optionSchema, optionValue) {
  if (
    optionSchema.choices &&
    !optionSchema.choices.includes(optionValue)
  ) {
    throw usageError(
      commandSchema,
      `option ${optionName} must be one of ${optionSchema.choices.join("|")}.`,
    );
  }
}

export function parseCliArguments(command, args = []) {
  const commandSchema = Object.hasOwn(CLI_COMMAND_SCHEMAS, command)
    ? CLI_COMMAND_SCHEMAS[command]
    : undefined;
  if (!commandSchema) {
    throw new CliUsageError(
      'CLI_USAGE_ERROR: unknown command.\nRun "help" to list commands.',
    );
  }
  if (!Array.isArray(args)) {
    throw usageError(commandSchema, "arguments must be an array.");
  }

  const parsed = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (typeof token !== "string" || !token.startsWith("--")) {
      throw usageError(commandSchema, "unexpected positional argument.");
    }

    const optionSchema = Object.hasOwn(commandSchema.options, token)
      ? commandSchema.options[token]
      : undefined;
    if (!optionSchema) {
      throw usageError(commandSchema, "unknown option.");
    }
    if (seen.has(token)) {
      throw usageError(commandSchema, `duplicate option ${token}.`);
    }
    seen.add(token);

    if (optionSchema.kind === "flag") {
      parsed[token] = true;
      continue;
    }

    const next = args[index + 1];
    if (next === undefined || next === "") {
      throw usageError(commandSchema, `option ${token} requires a value.`);
    }
    if (typeof next !== "string" || next.startsWith("--")) {
      throw usageError(
        commandSchema,
        `option ${token} cannot use another option as its value.`,
      );
    }
    assertChoice(commandSchema, token, optionSchema, next);
    parsed[token] = next;
    index += 1;
  }

  for (const [optionName, optionSchema] of Object.entries(
    commandSchema.options,
  )) {
    if (optionSchema.required && !seen.has(optionName)) {
      throw usageError(
        commandSchema,
        `required option ${optionName} is missing.`,
      );
    }
  }

  for (const optionGroup of commandSchema.exactlyOneOf) {
    const present = optionGroup.filter((optionName) => seen.has(optionName));
    if (present.length === 0) {
      throw usageError(
        commandSchema,
        `exactly one of ${optionGroup.join(" or ")} is required.`,
      );
    }
    if (present.length > 1) {
      throw usageError(
        commandSchema,
        `${optionGroup.join(" and ")} cannot be used together.`,
      );
    }
  }

  return Object.freeze({
    command: commandSchema.command,
    options: Object.freeze(parsed),
  });
}
