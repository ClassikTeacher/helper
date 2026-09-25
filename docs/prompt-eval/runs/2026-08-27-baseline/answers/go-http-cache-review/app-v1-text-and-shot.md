Ревью: Go-приложение для кэширования пользователей с HTTP-сервером

Critical

Lines 26–28, 63–65: Игнорирование ошибок при создании запроса и выполнении HTTP-операций (http.NewRequest, httpCli.Do, ioutil.ReadAll, json.Unmarshal). Ошибки молча игнорируются через _, что приводит к необработанным nil-указателям и паникам. Исправление: проверять ошибки и возвращать их вызывающему коду.
func FetchUser(id string) (string, error) {
	req, err := http.NewRequest("GET", baseURL+"/users/"+id, nil)
	if err != nil {
		return "", err
	}
	resp, err := httpCli.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	b, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	var u User
	if err := json.Unmarshal(b, &u); err != nil {
		return "", err
	}
	// ...
}
Lines 63–65: Race condition в handler: чтение из cache без блокировки после cacheMu.Unlock() на строке 62, затем запись в cache с cacheMu.RLock() (неправильная блокировка — RLock для записи). Между разблокировкой и повторной блокировкой другая горутина может изменить кэш. Исправление: использовать RLock только для чтения, Lock для записи, и не разблокировать между проверкой и использованием.
cacheMu.Lock()
if v, ok := cache[id]; ok {
	cacheMu.Unlock()
	fmt.Fprintln(w, v)
	return
}
cacheMu.Unlock()

name, err := FetchUser(id)
if err != nil {
	http.Error(w, err.Error(), http.StatusInternalServerError)
	return
}

cacheMu.Lock()
cache[id] = name
cacheMu.Unlock()
Line 32: Запись в глобальный cache без синхронизации внутри горутины go func(). Это race condition. Исправление: использовать cacheMu.Lock() при записи.
go func() {
	cacheMu.Lock()
	cache[id] = name
	cacheMu.Unlock()
}()
High

Line 65: panic(err) в обработчике HTTP-запроса приводит к краху сервера. Ошибка должна быть возвращена клиенту. Исправление: использовать http.Error с соответствующим кодом статуса.

Line 22: Глобальная переменная requests увеличивается без синхронизации (requests++). Race condition при конкурентных запросах. Исправление: использовать sync.Atomic или защитить мьютексом.

Medium

Line 51: HTTP-ошибка возвращается с кодом http.StatusInternalServerError (500) для отсутствующего параметра, что семантически неправильно. Должен быть http.StatusBadRequest (400). Исправление: http.Error(w, "missing id", http.StatusBadRequest).

