# Vendored `scap` 0.1.0-beta.1 — патч для Windows

## Почему это здесь

Спайк `scap` (Фаза 0.5, tasks.md) обнаружил блокер: и `scap` 0.1.0-beta.1, и `scap`
0.0.8 с crates.io **не компилируются на Windows** против актуальной опубликованной
`windows-capture` 1.5.0 — сигнатуры API разошлись (переименование `timespan()` →
`timestamp()`, другой порядок параметров `Settings::new(...)` для варианта
`Target::Display`). Баг открыт апстримом и не исправлен:
<https://github.com/CapSoftware/scap/issues/180> (открыт 2025-12-11, обсуждается,
без релиза с фиксом на момент спайка, 2026-07-02).

## Обходной путь

Вместо форка на GitHub — локальный vendor-копия крейта с точечным патчем (тот же
фикс, что предложен в обсуждении issue #180):

1. `src/capturer/engine/win/mod.rs`: `frame.timespan()` → `frame.timestamp()`.
2. `src/capturer/engine/win/mod.rs`: в ветке `Target::Display(...)` порядок
   аргументов `WCSettings::new(...)` приведён к порядку, который ожидает
   `windows-capture` 1.5.0 (`color_format` — предпоследний аргумент, перед
   `FlagStruct`, как уже было в ветке `Target::Window`).

`Cargo.toml` (`app/src-tauri/Cargo.toml`) подключает патч через
`[patch.crates-io] scap = { path = "vendor/scap" }`.

## Когда убрать

Как только апстрим выпустит версию, совместимую с `windows-capture >= 1.5.0`
(или сам поднимет диапазон зависимости и починит вызовы) — обновить обычную
зависимость `scap` в `Cargo.toml` и удалить `[patch.crates-io]` + эту папку.
