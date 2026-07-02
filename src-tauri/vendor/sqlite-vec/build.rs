fn main() {
    // Патч (спайк 0.5, ai-helper): опубликованный крейт 0.1.10-alpha.4 не
    // включает `sqlite-vec-diskann.c` / `sqlite-vec-rescore.c` в архив на
    // crates.io, хотя `sqlite-vec.c` по умолчанию (`#ifndef ... #define ... 1`)
    // их `#include`-ит. Без этих defines сборка падает с
    // "sqlite-vec-diskann.c: No such file or directory". DiskANN/rescore —
    // экспериментальные индексы, не нужные для базового vec0 KNN (см.
    // vendor/sqlite-vec/NOTES.md). Отключаем их явно, а не полагаемся на
    // default в C-файле.
    cc::Build::new()
        .file("sqlite-vec.c")
        .define("SQLITE_CORE", None)
        .define("SQLITE_VEC_ENABLE_DISKANN", "0")
        .define("SQLITE_VEC_ENABLE_RESCORE", "0")
        .compile("sqlite_vec0");
}
