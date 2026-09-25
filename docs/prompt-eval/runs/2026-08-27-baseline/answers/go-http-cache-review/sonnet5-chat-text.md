Ревью
🔴 Критично: data race и паника на конкурентных записях в map
go
go func() {
    cache[id] = name
}()

Здесь запись в map происходит вообще без мьютекса, в отдельной горутине, при этом сама горутина никак не дожидается своего завершения. Одновременно с этим где-то ещё пишут и читают ту же карту под cacheMu. Это классический data race — при параллельных запросах Go рантайм упадёт с fatal error: concurrent map writes, что убьёт весь процесс (это не recoverable panic).

Плюс сам факт использования отдельной горутины здесь бессмысленен — операция дешёвая, никакого выигрыша от асинхронности нет, только риск.

🔴 Критично: неправильный тип блокировки при записи
go
cacheMu.RLock()
cache[id] = name
cacheMu.RUnlock()

RLock — это блокировка на чтение, она допускает параллельный доступ нескольких горутин. Но здесь под ней происходит запись в map. Если два запроса одновременно попадут сюда для разных (или тех же) id, оба получат RLock параллельно и одновременно начнут писать в один и тот же map — опять concurrent map writes. Нужно использовать Lock().

🔴 Критично: возможный nil pointer dereference
go
resp, _ := httpCli.Do(req)
defer resp.Body.Close()

Ошибка от Do полностью игнорируется. Если запрос не удался (таймаут, DNS-ошибка, сервер недоступен), resp будет nil, и resp.Body.Close() тут же паникует с nil pointer dereference.

🔴 Критично: все ошибки проглатываются
go
req, _ := http.NewRequest(...)
resp, _ := httpCli.Do(req)
b, _ := ioutil.ReadAll(resp.Body)
_ = json.Unmarshal(b, &u)

Ни одна ошибка не проверяется. При этом сигнатура FetchUser(id string) (string, error) обещает возвращать ошибку, но по факту всегда возвращает nil — даже если сеть недоступна или JSON битый. Вызывающий код (handler) думает, что может доверять err, но реально это фикция. В худшем случае пользователь получит пустое имя без единого намёка на то, что что-то пошло не так.

🟠 Гонка на счётчике запросов
go
requests++

Инкремент не атомарен и не защищён мьютексом — под конкурентной нагрузкой это тоже гонка (хоть и не паникующая, а просто теряющая часть инкрементов). Нужно либо atomic.AddInt64, либо отдельный мьютекс, либо вообще выкинуть, раз переменная нигде не используется.

🟠 panic(err) в обработчике HTTP-запроса
go
name, err := FetchUser(id)
if err != nil {
    panic(err)
}

Даже с учётом того, что net/http перехватывает панику на уровне одного запроса и не роняет весь сервер, это плохая практика: клиент получит пустой ответ с 500 без вменяемого тела, в логах будет "грязный" стектрейс, и это не даёт контроля над форматом ошибки.

🟠 Неверный HTTP-статус
go
if id == "" {
    http.Error(w, "missing id", http.StatusInternalServerError)
    return
}

Отсутствие обязательного параметра — это ошибка клиента, 400 Bad Request, а не 500 Internal Server Error.

🟡 Нет проверки resp.StatusCode

Даже если сеть отработала, внешний API мог вернуть 404/500 с телом ошибки — оно спокойно "распарсится" в User{} с пустыми полями, и в кэш ляжет пустая строка как валидный ответ.

🟡 Обрезка имени по байтам, а не по рунам
go
if len(name) > 10 {
    name = name[:10]
}

len() в Go считает байты, а не символы. Если имя содержит не-ASCII символы (кириллица, эмодзи), срез name[:10] может разрезать многобайтовый UTF-8-символ пополам и получить невалидную строку. Нужно приводить к []rune перед обрезкой.

🟡 Нет таймаута у HTTP-клиента
go
httpCli = &http.Client{}

Без Timeout запрос к внешнему API может зависнуть навсегда, если сервер не отвечает — и обработчик будет "висеть" бесконечно, съедая горутину.

🟡 Нет ограничений на сервере

http.ListenAndServe без ReadTimeout/WriteTimeout/ReadHeaderTimeout — уязвимо к slowloris-атакам и медленным клиентам.

🟡 Кэш растёт бесконечно

cache — обычная map без TTL и без ограничения размера. При долгой работе сервиса с большим числом уникальных id это утечка памяти.

🟡 ioutil устарел

С Go 1.16+ вместо ioutil.ReadAll стоит использовать io.ReadAll.

Как могла бы выглядеть более безопасная версия ключевых мест
go
func FetchUser(id string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, baseURL+"/users/"+id, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}

	resp, err := httpCli.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read body: %w", err)
	}

	var u User
	if err := json.Unmarshal(b, &u); err != nil {
		return "", fmt.Errorf("unmarshal user: %w", err)
	}

	runes := []rune(u.Name)
	if len(runes) > 10 {
		runes = runes[:10]
	}
	return string(runes), nil
}

func handler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&requests, 1)

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	cacheMu.RLock()
	v, ok := cache[id]
	cacheMu.RUnlock()
	if ok {
		fmt.Fprintln(w, v)
		return
	}

	name, err := FetchUser(id)
	if err != nil {
		log.Printf("fetch user %s: %v", id, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	cacheMu.Lock()
	cache[id] = name
	cacheMu.Unlock()

	fmt.Fprintln(w, name)
}

Плюс не забыть: httpCli.Timeout = 5 * time.Second, а requests сделать int64 под atomic, и добавить ReadHeaderTimeout серверу.