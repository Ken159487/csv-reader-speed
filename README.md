# csv-reader-speed

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Ken159487/csv-reader-speed/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Ken159487/csv-reader-speed/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A faster drop-in replacement for csv-reader 1.0.0, byte-identical on broken CSV files.

Entry for the [make.fun competition csv-reader-speed-01-run-20261121](https://make.fun/c/csv-reader-speed-01-run-20261121): read broken CSV files faster. `solve.js` exports `run(input)` returning `{columns, rows, errors}` — exactly the answer csv-reader 1.0.0 returns for every input — using a bulk `indexOf` scanner instead of the reference's per-character loop. `main.ts` is the kit driver, unchanged.

## Run it

Node 22 or later, no dependencies, no build step:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

The driver reads `cases.json` from the input directory and writes `answers.json` to the output directory.

## Verify it

From the unpacked kit directory, grade the entry on the practice set the way the server grades it:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/csv-reader-speed --driver process
```

Run the site's pre-submit checks with:

```sh
node cli/makefun.mjs check --kit . --repo /path/to/csv-reader-speed
```

Correctness is checked byte-for-byte against csv-reader 1.0.0 on the practice set and on generated sets from the kit's generator.

## License

MIT — see [LICENSE](LICENSE).
