# Coinbase Guard demo video

`delta-coinbase-guard-demo.avi` is a short, silent screen walkthrough of the
seven-step credential-free simulation:

1. natural-language intent;
2. closed policy;
3. digest confirmation;
4. deterministic proposal;
5. Coinbase-shaped Preview evidence;
6. simulated delta verification and proof; and
7. execution boundary and reconciled simulated result.

The recording contains no credentials, contacts no external system, and does
not depict a real Coinbase order.

Rebuild it on macOS:

```sh
pnpm run visuals
pnpm run video
```

The video builder requires Python 3 with Pillow. It writes a standard 1280×720
Motion JPEG AVI so the artifact is self-contained and does not require a
downloaded video encoder.
