# shit-1170-rex-unit-conversion

agent friendly unit conversion for near tokens.

turn a human amount (`1.5`) into the chain's unit amount
(`1500000000000000000000000`) and back, using the token's real decimals
from the intear api.

see [SKILL.md](./SKILL.md)

---

#### THE BIN

```sh
bun bin/unit_conversion.ts --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]
```

```sh
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5
bun bin/unit_conversion.ts --ca wrap.near --unit 1500000000000000000000000
bun bin/unit_conversion.ts --ca usdt.tether-token.near --decimal 0.5
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5 --decimals 24
```

JSON on stdout, errors as JSON on stderr with a non-zero exit code.

#### INSTALL

```sh
bun i
# run from this folder
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5
```

#### LIVE PAGE

🌐 <https://shit-1170.com/unit-conversion.html>

=====================
<br/>
copyright 2026 by sleet.near
