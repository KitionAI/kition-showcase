# tidewater

Tide predictions for small harbours, computed offline from harmonic constants. No network, no account, about 400 KB of data per country.

> [!TIP] Status
> Version 0.9 is feature-complete for UK and Irish ports. Nordic ports are in progress.

## Install

```sh
cargo install tidewater
tidewater fetch-constants --country gb
```

## Usage

```rust
use tidewater::{Harbour, Tides};

let harbour = Harbour::by_name("Porthmellon")?;
for event in Tides::for_day(&harbour, "2026-11-09")? {
    println!("{} {:>5.2} m", event.time, event.height);
}
```

## Features

- High and low water times to within two minutes
- Heights relative to chart datum, in metres or feet
- Daylight saving handled from the harbour's own time zone
- A `--json` flag for scripts and dashboards

## Configuration

| Option       | Default  | Meaning                          |
| ------------ | -------- | -------------------------------- |
| `units`      | `metres` | Height units                     |
| `datum`      | `chart`  | Reference level                  |
| `cache_days` | `14`     | Days of predictions kept offline |

```toml
[tidewater]
units = "feet"
harbours = ["Porthmellon", "Kilrush"]
```

## Contributing

1. Open an issue before large changes.
2. Run `cargo test` and `cargo clippy` before a pull request.
3. New harbours need a source for their constants.

## Licence

MIT or Apache-2.0, at your choice.
