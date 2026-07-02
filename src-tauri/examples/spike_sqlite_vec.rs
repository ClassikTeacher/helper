//! Spike (Фаза 0.5, tasks.md): де-риск `sqlite-vec` через `tauri-plugin-sql`.
//!
//! Throwaway-код, но найденный обходной путь — рабочий и переносится в прод
//! (фаза 4, `lib.rs`), так как `tauri-plugin-sql` Builder не даёт хука для
//! загрузки расширений на соединение.
//!
//! ## Вывод спайка
//! `tauri-plugin-sql` 2.4.0 создаёт SQLite-пул через `sqlx::Pool::connect(url)`
//! (см. `wrapper.rs::DbPool::connect`), принимая только URL-строку. У
//! `sqlx::SqliteConnectOptions` есть `.extension(name)`, но `Builder`
//! `tauri-plugin-sql` его никак не прокидывает и не имеет иного способа
//! кастомизировать опции соединения — **прямого пути загрузить `sqlite-vec`
//! через публичный API плагина нет**.
//!
//! Обходной путь (без форка плагина): `sqlite-vec` регистрируется процессом
//! ОДИН РАЗ через `sqlite3_auto_extension` — нативную функцию SQLite,
//! которая применяет расширение автоматически к **каждому** новому
//! соединению, открытому в процессе, независимо от того, кто его открыл
//! (`sqlx` напрямую или `tauri-plugin-sql` внутри). Единственное условие —
//! `libsqlite3-sys`, через который мы дёргаем `sqlite3_auto_extension`,
//! должен резолвиться в ТУ ЖЕ версию (и потому в ту же скомпилированную
//! копию бандленного SQLite), что использует `sqlx-sqlite` — иначе
//! регистрация уйдёт в другую копию библиотеки и не подействует на
//! соединения `tauri-plugin-sql`. Semver-диапазоны в Cargo.toml подобраны
//! так, чтобы Cargo схлопнул зависимость в одну версию (см. комментарий там).
//!
//! Этот пример дёргает `sqlx::SqlitePool` напрямую (тот же кодовый путь,
//! что и `DbPool::connect` внутри `tauri-plugin-sql`), чтобы не тащить
//! полный Tauri runtime в throwaway-спайк — код открытия соединения
//! идентичен, поэтому вывод переносится на реальный плагин 1:1.
//!
//! Запуск: `cargo run --example spike_sqlite_vec` из `app/src-tauri`.

use libsqlite3_sys::sqlite3_auto_extension;
use sqlite_vec::sqlite3_vec_init;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== spike: sqlite-vec через sqlx (тот же путь, что tauri-plugin-sql) ===");

    // Регистрация ДО открытия любых соединений — глобальная, на весь процесс.
    unsafe {
        let rc = sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
        if rc != 0 {
            eprintln!("BLOCKER: sqlite3_auto_extension вернул код ошибки {rc}");
            std::process::exit(1);
        }
    }
    println!("sqlite3_auto_extension(sqlite_vec_init): OK (rc=0)");

    // In-memory — как и `tauri-plugin-sql`, использует стандартный
    // `sqlx::Pool::<Sqlite>::connect`, только с in-memory URL вместо
    // файлового пути из app_config_dir (несущественно для теста расширения).
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;

    let versions = sqlx::query("select sqlite_version(), vec_version()")
        .fetch_one(&pool)
        .await;

    let row = match versions {
        Ok(r) => r,
        Err(e) => {
            eprintln!("BLOCKER: vec_version() недоступна — расширение не подхватилось: {e}");
            std::process::exit(1);
        }
    };
    let sqlite_version: String = row.try_get(0)?;
    let vec_version: String = row.try_get(1)?;
    println!("OK: sqlite_version={sqlite_version} vec_version={vec_version}");

    sqlx::query("CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[4])")
        .execute(&pool)
        .await?;
    println!("OK: создана виртуальная таблица vec0");

    // Вектора в JSON-текстовом виде — vec0 принимает JSON-массив напрямую,
    // без бинарного blob-формата (упрощает throwaway-код, без zerocopy).
    sqlx::query(
        "INSERT INTO vec_items(rowid, embedding) VALUES \
         (1, '[0.1,0.1,0.1,0.1]'), \
         (2, '[0.2,0.2,0.2,0.2]'), \
         (3, '[0.9,0.9,0.9,0.9]')",
    )
    .execute(&pool)
    .await?;
    println!("OK: вставлено 3 вектора");

    let rows = sqlx::query(
        "SELECT rowid, distance FROM vec_items \
         WHERE embedding MATCH '[0.3,0.3,0.3,0.3]' \
         ORDER BY distance LIMIT 3",
    )
    .fetch_all(&pool)
    .await?;

    println!("OK: KNN-поиск вернул {} строк:", rows.len());
    for r in &rows {
        let rowid: i64 = r.try_get("rowid")?;
        let distance: f64 = r.try_get("distance")?;
        println!("  rowid={rowid} distance={distance:.4}");
    }

    // Евклидово расстояние до [0.3,0.3,0.3,0.3]: rowid=2 [0.2]→0.2, rowid=1
    // [0.1]→0.4, rowid=3 [0.9]→1.2 — ближайший действительно rowid=2.
    let nearest: i64 = rows[0].try_get("rowid")?;
    if nearest != 2 {
        eprintln!(
            "ВНИМАНИЕ: ожидался ближайший rowid=2 (вектор [0.2,0.2,0.2,0.2] ближе всех к [0.3,0.3,0.3,0.3]), получено {nearest}"
        );
        std::process::exit(1);
    }

    println!("=== spike sqlite-vec: OK, KNN-порядок корректен ===");
    Ok(())
}
