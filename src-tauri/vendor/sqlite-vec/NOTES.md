# Vendored `sqlite-vec` 0.1.10-alpha.4 — патч сборки

## Почему это здесь

Спайк `sqlite-vec` (Фаза 0.5, tasks.md) обнаружил блокер: опубликованный на
crates.io пакет `sqlite-vec` 0.1.10-alpha.4 **не собирается из коробки**.

`sqlite-vec.c` по умолчанию включает experimental-фичи через
`#ifndef SQLITE_VEC_ENABLE_DISKANN #define SQLITE_VEC_ENABLE_DISKANN 1` (и
аналогично `SQLITE_VEC_ENABLE_RESCORE`), что триггерит
`#include "sqlite-vec-diskann.c"` / `#include "sqlite-vec-rescore.c"`.
Эти два файла **отсутствуют в архиве, опубликованном на crates.io** (пакет
содержит только `sqlite-vec.c/.h`, `sqlite3.h`, `sqlite3ext.h`) — судя по
всему, `Cargo.toml`/`include` не обновили при добавлении этих файлов в
основной репозиторий (появились в `v0.1.10-alpha.1`). Результат: `cargo build`
падает на `cl.exe` с `fatal error C1083: sqlite-vec-diskann.c: No such file or
directory`.

IVF (`SQLITE_VEC_EXPERIMENTAL_IVF_ENABLE`) по умолчанию **выключен** (`0`) —
не задет багом.

## Обходной путь

`build.rs` явно передаёт `-DSQLITE_VEC_ENABLE_DISKANN=0` и
`-DSQLITE_VEC_ENABLE_RESCORE=0` в `cc::Build`, отключая эти
экспериментальные индексы на уровне препроцессора — так `#include` на
недостающие файлы не компилируется. Базовый функционал (`vec0` виртуальная
таблица, KNN через `MATCH`/`ORDER BY distance`) не использует DiskANN/rescore
и не затронут.

`Cargo.toml` (`app/src-tauri/Cargo.toml`) подключает патч через
`[patch.crates-io] sqlite-vec = { path = "vendor/sqlite-vec" }`.

## Когда убрать

Как только апстрим добавит недостающие `.c`-файлы в публикуемый пакет (или
поправит default-defines) — вернуться на обычную зависимость `sqlite-vec` из
`Cargo.toml` и удалить `[patch.crates-io]` + эту папку. Если в будущем
понадобится DiskANN/rescore — тогда придётся отдельно вендорить и эти файлы
из GitHub (https://github.com/asg017/sqlite-vec), а не просто отключать их.
