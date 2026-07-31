#!/usr/bin/env node
import { listenAdvisorServer } from "./advisor/server.js";

function configuredPort() {
  const raw = process.env.DELTA_COINBASE_ADVISOR_PORT ?? "4173";
  if (!/^(?:0|[1-9]\d{0,4})$/.test(raw)) {
    throw new Error(
      "DELTA_COINBASE_ADVISOR_PORT must be an integer from 0 through 65535",
    );
  }
  const value = Number(raw);
  if (value > 65_535) {
    throw new Error(
      "DELTA_COINBASE_ADVISOR_PORT must be an integer from 0 through 65535",
    );
  }
  return value;
}

const running = await listenAdvisorServer({ port: configuredPort() });

process.stdout.write(
  [
    `Delta Guard Advisor: ${running.url}`,
    "LOCAL LOOPBACK · DRY RUN DEFAULT · OPTIONAL VIEW-ONLY CONNECTION",
    "COINBASE CREATE UNAVAILABLE · NO ORDER OR MONEY MOVEMENT",
    "",
  ].join("\n"),
);

async function stop() {
  await running.close();
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
