# shit-1170-rex-unit-conversion

agent friendly unit conversion for near tokens.

turn a human amount (`1.5`) into the chain's unit amount
(`1500000000000000000000000`) and back, using the token's real decimals
from the intear api.

use it to convert an amount, and to double check one that was already
worked out — a wrong amount succeeds on chain and fails silently.

see [SKILL.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-unit-conversion/SKILL.md)

---

#### THE BINS

two bins, the same conversion. use whichever fits the environment.

```sh
# bun
bun bin/unit_conversion.ts --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]

# python — no bun, no node, no pip install, no venv
python3 bin/unit_conversion.py --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]
```

```sh
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5
bun bin/unit_conversion.ts --ca wrap.near --unit 1500000000000000000000000
bun bin/unit_conversion.ts --ca usdt.tether-token.near --decimal 0.5
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5 --decimals 24

python3 bin/unit_conversion.py --ca wrap.near --decimal 1.5
python3 bin/unit_conversion.py --ca usdt.tether-token.near --decimal 0.5
```

JSON on stdout, errors as JSON on stderr with a non-zero exit code.

the two produce identical output — same flags, same JSON, same errors.

#### INSTALL

```sh
bun i
# run from this folder
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5
```

the python bin needs nothing installed.

#### TESTS

```sh
# the two bins must agree, on the math and on the errors
python3 evals/difftest.py .
```

#### LIVE PAGE

🌐 <https://shit-1170.com/unit-conversion.html>

=====================
<br/>
copyright 2026 by sleet.near
